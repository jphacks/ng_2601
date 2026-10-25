# PostgreSQL database schema

Use PostgreSQL with PostGIS. PostgreSQL stores user-owned data and community observations. External datasets remain local, versioned files under `data/raw/` and `data/normalized/`; they are not copied into the application database for the initial release.

The complete ER diagram is [database-schema.mmd](database-schema.mmd). Render it with:

```sh
mmdc -i docs/database-schema.mmd -o docs/database-schema.png -s 2 -b white
```

## Authentication

Google OAuth is the primary sign-in method. Store the Google OpenID Connect `sub` claim in `auth_identities.provider_subject`; do not use the email address as the identity key.

Email magic links are the fallback. The application creates a short-lived, single-use random token, stores only `token_hash` in `email_login_tokens`, and sends the original token through the Google SMTP server. Google SMTP delivers email; it does not authenticate the user. The token is consumed once, then the backend creates a normal session.

`auth_sessions.refresh_token_hash` stores only a hash of each refresh token. Access tokens may be short-lived signed JWTs. Revoking a session invalidates its refresh token. Never store Google access tokens or client secrets in these tables.

## Mobility profile

`users` stores one personal default directly: a bicycle type and the hill, traffic, surface, and walking preferences used when a route request does not provide explicit values. `bike_type` must match an identifier in `config/routing_catalog.json`.

The database does not duplicate BRouter physical constants. The routing catalog remains the source of truth for mass, rider power, rolling resistance, and BRouter implementation selection.

## Community observations

The MVP accepts points only, stored as `geography(Point, 4326)` in `observations.location`. Add a GiST index on this column. This enables “active observations near this route” queries while avoiding premature support for drawing lines and polygons.

`temporal_kind` describes how time is interpreted:

| `temporal_kind` | Required fields |
| --- | --- |
| `permanent` / `trend` | `observed_at` |
| `time_of_day` | `observed_at`, documented time-of-day rule in structured metadata added later |
| `date_range` | `starts_at`, `ends_at` |
| `temporary` | `observed_at`, `expires_at` |

Use database `CHECK` constraints to enforce these combinations. The current API
filters reports whose start/end/expiry window is not active at read time; it
does not run an expiry worker or rewrite rows to `expired` automatically.
Moderation can set an explicit status, and a future expiry job may do so while
preserving the original timestamps. Confirmations are evidence only and do not
extend a report or change its routing effect.

`observation_confirmations` implements the teammate’s “still exists / no longer exists” idea and also supports inaccurate or duplicate reports. One user has at most one current confirmation per observation; a later submission replaces its state.

## Moderator API

Moderation has no database identity or audit tables in this release. A separate backend-only endpoint such as `/v1/moderation/observations/{observation_id}` accepts a bearer token and updates the observation’s verification/status fields directly.

Store the long, random moderator token in the backend environment, for example `MODERATOR_API_TOKEN`; never commit it or store it in PostgreSQL. Compare the bearer token in constant time, configure rate limiting at the edge (no moderator-specific app limiter exists yet), and rotate the environment secret by redeploying the backend. The endpoint is for the team’s own moderation tool, not normal frontend users. A Google identity and a magic-link identity can share an email address; `provider` plus `provider_subject` remains the key and email is only a linking hint.

## Saved places and routes

Saved places and routes are private. A saved route stores its endpoints, the selected bike type and resolved preferences. The reserved GeoJSON snapshot columns are currently unpopulated by CRUD. It can later be re-evaluated against locally held official data and database-backed community observations to create route-change notifications.

Treat home, work, school, and daycare locations as sensitive: do not expose them in public APIs, map layers, logs, or aggregate analytics. The current foreign keys delete identities, sessions, saved places, and saved routes when a user is deleted. Observations and confirmations retain their content and set the user reference to NULL. There is no account-deletion API or retention worker yet.

## Local external data

Keep these outside PostgreSQL:

| Source | Local path | Database use |
| --- | --- | --- |
| JARTIC regulation overlay | `data/normalized/restrictions/jartic.geojson` | Route restriction provider reads snapshot |
| NPA accident history | `data/normalized/context/npa_accidents.geojson` | Route-context aggregate provider reads snapshot |
| MLIT/JARTIC traffic cache | `data/normalized/context/traffic_volume.geojson` | Traffic provider scores candidates when coverage is sufficient |

Each snapshot should carry source ID, authority, source URL, dataset/version,
observation window, retrieval time, checksum, importer version, and attribution
text in its manifest or GeoJSON metadata. The backend returns the provenance
available in the loaded snapshot to the frontend; missing metadata remains
missing instead of being inferred.

## Initial migration order

1. Enable `pgcrypto` and `postgis`.
2. Create `users`, `auth_identities`, `auth_sessions`, and `email_login_tokens`.
3. Create `observations` and `observation_confirmations`, including the spatial GiST index and temporal `CHECK` constraints.
4. Create `saved_places` and `saved_routes`.
5. Apply `003_map_query_indexes.sql` outside a transaction; both map indexes use concurrent creation.
6. Apply `004_device_surface_events.sql` for the independent CoreS3 measurement table.
7. If upgrading an existing prototype database, apply `002_auth_identity_email_index.sql`; it allows Google and magic-link identities with the same email to coexist.

Do not add local external-data tables in this release. Their snapshot manifests and backend source-status endpoint provide operational visibility without mixing imported data with user data.

## Device surface measurements

Migration 004 adds `device_surface_events`, separate from community reports. Its
composite primary key is `(device_id, event_id)`; `id` is a unique UUID for map
features. `location` is PostGIS `geography(Point, 4326)`, times are `timestamptz`,
and sensor values use `real`. `payload_fingerprint` detects changed retries.
The API bounds sensor values and requires aware timestamps, HDOP <= 5, and a
30-day ingest window; only the event kind is constrained in SQL. Public reads
exclude device identity and return only measurements from the last 30 days.
There is no physical deletion job; older rows remain stored but hidden.
