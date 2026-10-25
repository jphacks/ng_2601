# CyclerHub-back API

Version 1. The backend is the only public application service. BRouter and
PostgreSQL stay on the private Compose network. Coordinates are WGS84 and use
`lon`/`lat` in JSON; GeoJSON coordinates remain `[longitude, latitude]`.

## Conventions

- `Authorization: Bearer <access-token>` is required wherever marked
  **authenticated**.
- Access tokens are short-lived JWTs. Refresh tokens are rotated by the
  authentication endpoints and are never returned by routing or map APIs.
- A source-bearing response keeps `source_id`, authority, source kind,
  confidence, dataset version, and retrieval/observation times visible. The
  client must not infer authority from a filename or label.
- Official restrictions, route context, and community observations are
  separate. Accident history and traffic volume never create a legal block;
  unverified reports never create a routing penalty.

## Service and discovery

### `GET /health`

Returns `{ "status": "ok" }`. This checks the HTTP process only; it does not
claim that BRouter, PostgreSQL, or an external-data snapshot is available.

### `GET /v1/routing-options`

Returns the routing catalog: supported `bike_type` values, their defaults and
capabilities, and the selectable preference values. The catalog is the source
of truth for user-selectable values; clients should render those values instead
of hard-coding them. BRouter profile and ruleset implementation identifiers are
intentionally kept server-side.

### `GET /v1/routing-sources`

Returns the loaded status and metadata for JARTIC restrictions, NPA
accident history, MLIT/JARTIC traffic volume, and the PostgreSQL preference
store. This is useful for diagnostics and a data-status screen. It does not
return raw files.

## Routing

### `POST /v1/routes`

Request:

```json
{
  "start": {"lat": 35.170, "lon": 136.880},
  "end": {"lat": 35.180, "lon": 136.900},
  "bike_type": "mamachari",
  "preferences": {
    "hill_mode": "avoid",
    "traffic_mode": "avoid",
    "surface_mode": "comfortable",
    "walking_mode": "short"
  }
}
```

`bike_type` and `preferences` are optional. For an authenticated request, the
user's saved default profile supplies omitted values; request values override
saved values. An unauthenticated request uses the catalog defaults. The
request body never accepts a user ID.

The backend asks BRouter for up to three alternatives when restrictions or
traffic data are loaded. Only the first BRouter error is fatal; a later
alternative error ends the search and the valid first route is retained. A
candidate intersecting an active `enforcement: "block"` restriction is
discarded. Traffic volume can rank candidates only when coverage is adequate;
missing coverage is returned as `partial` or `unavailable`. Snapshots older than
four hours (or future-dated) are `stale` and have no routing penalty. Undated
snapshots are `unavailable`. `traffic_mode=direct` retains the first legal
candidate regardless of measured traffic.

Response shape:

```json
{
  "route": {"type": "FeatureCollection", "features": []},
  "resolved": {
    "bike_type": "mamachari",
    "preferences": {"traffic_mode": "avoid"},
    "ruleset": "japan_ordinary_bicycle_v1",
    "evaluated_at": "2026-10-25T09:00:00+09:00"
  },
  "restriction_assessment": {
    "source_enabled": true,
    "alerts": []
  },
  "route_context": {
    "accident_history": {"status": "available", "source_id": "npa_accident_history", "total_accidents": 0},
    "traffic": {"status": "unavailable", "source_id": "mlit_jartic_traffic_volume"}
  }
}
```

`restriction_assessment.alerts` includes the source and enforcement for each
hit. `route_context.accident_history` is an aggregate around the route with an
evidence window and radius. A loaded accident dataset is `available` even when
the query finds zero nearby records; `coverage` describes dataset completeness.
`route_context.traffic` includes snapshot observation time, matched length, route length,
coverage ratio, and the applied penalty when one was used. Traffic candidates
are ranked only when the selected snapshot reports `available` coverage; a
partial, stale, or unavailable snapshot leaves the first legal candidate in place
when no other candidate has available coverage.

The routing effects are deliberately separate: BRouter's graph/profile and the
catalog preferences always form the base route; an imported JARTIC record
with explicit `enforcement: "block"` can discard a candidate; measured traffic
can rank legal alternatives when coverage is adequate; NPA accident history is
returned for context only. Rows in PostgreSQL `observations` are not read by
`POST /v1/routes` and do not affect routing until a future validation and
promotion policy is implemented.

## Map layers and community observations

### `GET /v1/map-data`

Required query parameters: `min_lon`, `min_lat`, `max_lon`, `max_lat`.
Optional `limit` defaults to 200 and is capped at 500 for each source group.
The response contains separate source groups:

The longitude/latitude bounds are inclusive and use WGS84 decimal degrees.
File-backed point, line, and polygon features are returned when their actual
geometry intersects the box; a feature crossing the boundary is returned in
full and is not clipped. Invalid coordinate ranges, including `min_lon >
max_lon` or `min_lat > max_lat`, return `422`. Antimeridian-wrapping boxes are
not supported by this version. Each group includes `truncated: true` when more
than `limit` matching features were available. The default maximum bbox area is
25 square degrees and can be changed with `MAX_MAP_BBOX_AREA_DEG2`.

- `restrictions`: active JARTIC official restriction features;
- `route_context.accidents`: NPA historical accident features;
- `route_context.traffic`: MLIT/JARTIC measured traffic features;
- `observations`: active, non-expired community reports.

`route_context.surface` returns experimental CoreS3 bump/roughness points from
PostgreSQL within the bbox and the last 30 days. It has `truncated` and
`source_status`, uses `source_id: cores3_surface_v1`, and has no routing effect.
The experimental device ingest contract is described below.

Each group contains its source status or source metadata. The map endpoint is
public, but private saved places/routes are never included.

### `GET /v1/observations`

Uses the same bounding-box parameters, with optional `category` and `limit`.
Returns a GeoJSON `FeatureCollection` of active, non-expired community reports.
The point location must fall inside the inclusive box. Reports outside the box
are excluded before the result limit is applied. The response includes
`truncated: true` when additional matching reports were available.
Each feature is `source_id: "user_report"`, `authority: "community"`, and
`routing_effect: "none_until_validated"`.

### `POST /v1/observations` **(authenticated)**

Creates a point report with `category`, `location`, `temporal_kind`,
`observed_at`, optional `starts_at`/`ends_at` for a date range, optional
`expires_at` for temporary reports, and an optional description. New reports
are `verification_state: "unverified"` and have no routing effect.

### `POST /v1/observations/{observation_id}/confirmations` **(authenticated)**

Records the caller's current `state`: `still_present`, `cleared`, `inaccurate`,
or `duplicate`. A caller has one replaceable confirmation per observation.
Confirmations are community evidence and do not change routing automatically.

## Authentication

All authentication routes are under `/v1/auth`.

| Endpoint | Purpose |
| --- | --- |
| `POST /magic-link/request` | Public. Requests a rate-limited email link. |
| `POST /magic-link/consume` | Exchanges a valid single-use link for a session. |
| `GET /google` | Creates a Google authorization URL and an HttpOnly OAuth-state cookie. |
| `GET /google/callback` | Validates the state cookie, exchanges the code, and returns a session and the Google profile `picture` URL (or `null`). |
| `POST /refresh` | Rotates a refresh token. |
| `POST /logout` | Revokes the presented refresh token. |
| `GET /me` | Returns the authenticated user's default bike and preferences. |
| `PUT /me/preferences` | Updates the authenticated user's single default profile. |

Google OAuth is attempted first by clients that have real Google credentials.
Email magic links are the fallback provider. The backend's OAuth state is
single-use, expires after ten minutes, and is bound to the initiating browser
cookie. `SMTP_TEST_RECEIVER` is only a local relay test destination; it is not
an authentication fallback address for real users.

## Private saved mobility data **(authenticated)**

These endpoints are owner-scoped. No user ID is accepted from the request
body, and saved locations are never returned by public map APIs.

### Saved places

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/saved-places` | List the caller's places. |
| `POST` | `/v1/saved-places` | Create a labelled point. |
| `PATCH` | `/v1/saved-places/{place_id}` | Update its label or point. |
| `DELETE` | `/v1/saved-places/{place_id}` | Delete it. |

### Saved routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/saved-routes` | List the caller's usual routes. |
| `POST` | `/v1/saved-routes` | Save endpoints, bike type, and preferences. |
| `PATCH` | `/v1/saved-routes/{route_id}` | Update those saved inputs. |
| `DELETE` | `/v1/saved-routes/{route_id}` | Delete it. |

The existing `last_route_geojson` columns are reserved for a later route
snapshot/monitoring job; CRUD in this release does not expose another user's
route or silently recompute a saved route.

## Moderator API

### `PATCH /v1/moderation/observations/{observation_id}`

Requires `Authorization: Bearer <MODERATOR_API_TOKEN>`. This is a backend-only
token endpoint; there is no moderator table or frontend moderator account.
The body may set `status` (`active`, `resolved`, `withdrawn`, `expired`) and/or
`verification_state` (`unverified`, `corroborated`, `moderated`).

## Experimental: CoreS3 road-surface measurements

The [CoreS3 firmware](../../seams/README.md) sends candidate bumps and roughness, not verified road hazards. Measurements are kept separate from community reports and do not affect BRouter or route selection.

### `POST /v1/device-events`

Accepts one event and returns HTTP 201 with `event_id`, `accepted: true`, and `duplicate`. It requires `Authorization: Bearer <DEVICE_INGEST_TOKEN>`, a token dedicated to device ingestion. Set the token in `backend/.env` and restart the backend. Use HTTPS outside a trusted development LAN.

```json
{
  "schema_version": 1,
  "device_id": "cores3-demo",
  "event_id": "a1b2c3d4_00000001",
  "kind": "bump",
  "observed_at": "2026-10-25T02:00:00Z",
  "location": {"lat": 35.170, "lon": 136.880},
  "peak_delta_g": 0.8,
  "rms_g": 0.3,
  "gps_hdop": 1.2,
  "speed_kmph": 12.0
}
```

Coordinates are WGS84 decimal degrees. The event needs a timezone-aware time no more than five minutes in the future or 30 days in the past; GPS HDOP must be within (0, 5]. Unknown fields and out-of-range values are rejected. `(device_id, event_id)` deduplicates retries: the same payload is accepted again, while a changed payload with the same key returns 409. Existing databases need `./scripts/db/migrate.sh` from `back/` for migration 004; new Compose volumes apply it on initialization.

### Device measurements in `GET /v1/map-data`

`route_context.surface` contains events inside the requested bounding box from the last 30 days. Its GeoJSON collection includes `features`, `truncated`, and `source_status`. A point includes `kind`, `observed_at`, `peak_delta_g`, `rms_g`, `gps_hdop`, `source_id: cores3_surface_v1`, `authority: device_measurement`, `verification_state: unverified`, and `routing_effect: none`. Public map responses omit the device ID and full GPS trace. Detection thresholds and real-ride accuracy still need evaluation.

## Errors

| Status | Meaning |
| --- | --- |
| `400` | Invalid OAuth state or magic-link token. |
| `401` | Missing or invalid user bearer token. |
| `403` | Moderator token rejected. |
| `404` | Private record or observation does not exist for the caller. |
| `409` | No candidate route passed active legal restrictions. |
| `422` | Invalid coordinates, UUID, bike type, preference, or temporal fields. |
| `429` | Magic-link request rate limit exceeded. |
| `502` | BRouter or email provider returned an invalid/upstream response. |
| `503` | BRouter, database, OAuth, SMTP, or required local data is unavailable. |
