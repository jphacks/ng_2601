# Experimental CoreS3 road-surface events

This is a prototype API for the `seams/M5StackS3` firmware. The device sends candidate bumps and roughness, not verified road hazards. It does not affect BRouter or create community observations.

## Ingest

`POST /v1/device-events` accepts one JSON event and returns HTTP 201 with `event_id`, `accepted: true`, and `duplicate`. The request requires `Authorization: Bearer <DEVICE_INGEST_TOKEN>`. Set that token in `backend/.env` and restart the backend. Keep it out of Git and use HTTPS when sending beyond a trusted development LAN.

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

Coordinates use WGS84 decimal degrees. The event time must carry a time zone, be at most five minutes in the future, and no older than 30 days. GPS HDOP must be within (0, 5]. The server rejects unknown fields and bounds the numeric values. `device_id + event_id` is the deduplication key: a repeat of the same payload is accepted; a changed payload with that key returns 409.

Run `./scripts/db/migrate.sh` from `back/` to add migration 004 to an existing database. A new Compose database loads it on initialization.

## Map read

`GET /v1/map-data` adds `route_context.surface`, a GeoJSON FeatureCollection with `features`, `truncated`, and `source_status`. The response includes events in the requested bounding box observed within the last 30 days. Each point carries `kind`, `observed_at`, `peak_delta_g`, `rms_g`, `gps_hdop`, `source_id: cores3_surface_v1`, `authority: device_measurement`, `verification_state: unverified`, and `routing_effect: none`. The device ID and full GPS trace are not in the public map response.

The frontend labels these points as experimental measurements. The heuristic thresholds, GPS accuracy, and mounting need real-ride calibration before any route scoring or safety claim.

## Backend validation

Fresh migration, authenticated ingest, payload validation, idempotent retry,
changed-payload conflict, and bbox map read passed with PostgreSQL/PostGIS in
the [backend audit](validation.md). This does not establish device GPS/Wi-Fi or
ride calibration. The local device token is intentionally unconfigured until
an operator enables the device.
