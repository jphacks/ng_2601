# Backend validation — 2026-10-25

Scope: current `aki-api-integration` working tree, including uncommitted changes.
Frontend execution, physical device tests, and interactive Google consent were
excluded. No commits were created. No production data was seeded or deleted.

## Results

| Check | Result |
| --- | --- |
| Compose configuration and `DOWNLOAD_ROUTING_DATA=0 ./scripts/setup.sh` | Passed; initialized upstream submodule, 35 nonempty RD5 tiles |
| Backend/BRouter Docker images | Build succeeded (dependency layers cached); real routing verified separately |
| Environment keys | Local `.env` now includes all example keys; no credentials printed in this report |
| Startup session secret | Short local placeholder replaced by generated random secret; valid startup and short-secret rejection checked |
| Backend tests | 26 passed; three dependency/API deprecation warnings |
| Python compilation, shell syntax, diff whitespace | Passed |
| JARTIC | Official catalog reachable; cached Aichi ZIP reprocessed into 4,885 valid features |
| NPA | Cached official 2025 CSV reprocessed into 287,023 valid points; DMS, bicycle codes, Japan time, and year window checked |
| Traffic | Live official API download succeeded; refreshed local nationwide snapshot, 994 points |
| MLIT disruption overlay | No snapshot/importer available; provider correctly disabled, absent data not fabricated |
| Local source geometry and providers | All installed normalized files parsed, coordinate ranges validated, and loaded; no failed source required removal |
| Existing migrations | 001–004 recorded/applied; rerunning upgrade runner skipped applied versions |
| Fresh migrations | All four SQL files applied to disposable PostgreSQL/PostGIS databases |
| Schema comparison | Existing and fresh columns, types, nullability, defaults matched; no invalid indexes |
| API integration | 63 checks passed against real PostgreSQL/PostGIS, all local source providers, and real BRouter for five bike types |
| Live HTTP | Isolated Uvicorn process exercised using actual local `.env`; health, OpenAPI, options, source status, map layers, auth guards, and a real route passed |
| SMTP | 587 timed out; verified TLS + SMTP AUTH on 465 accepted one labelled test email; local `.env` updated to 465/ssl |
| OAuth | Dummy credentials correctly return 503; state cookie, browser binding, single-use protection and session flow checked with remote Google exchange intercepted |

The integration checks cover magic-link issuance/cooldown/consumption, refresh
rotation/logout, preference update, private saved-place/route CRUD and ownership,
UUID validation, observation creation/confirmation/moderation, bbox queries,
device ingestion/deduplication/conflicts, and DELETE CORS preflight. SMTP is
intercepted in those checks; the real delivery check is separate. Tokens and
test records are confined to disposable databases.

## Fixes made during validation

- NPA occurrence timestamps use Asia/Tokyo and include annual window metadata;
  the local normalized snapshot was regenerated.
- Traffic snapshots older than four hours, future-dated snapshots, and undated
  snapshots cannot rank routes. `direct` keeps the first legal candidate.
- Route-context queries reject distant accident/station points before metric
  matching, avoiding a nationwide per-point/per-segment scan.
- DELETE is permitted by CORS for private saved-data operations.
- Access JWTs require expiry, issue time, token type, and a UUID subject.
  Magic-link email validation rejects whitespace and malformed multi-@ input.
- Unhandled psycopg errors now return a generic 503 rather than an internal 500.
- API/ER/schema documents now include the implemented device measurement layer.

## Remaining deployment checks

- Host port 8080 is occupied by another service. Normal Compose backend startup
  failed to bind it. Checks used isolated containers without a host port; they
  do not establish that the intended public backend is reachable on 8080.
- Google sign-in requires real client credentials, the registered callback,
  and interactive browser consent. The frontend magic-link callback/login UI
  is also outside this backend audit.
- `DEVICE_INGEST_TOKEN` remains blank locally, so actual device ingestion stays
  disabled (503). Test credentials were generated only inside the harness.
- Device GPS/Wi-Fi/calibration, Cloudflare Tunnel, public-origin cookies/CORS,
  and frontend behavior have not been tested here.
- External snapshots reload only on process restart. Download refresh remains
  manual; no scheduler, retention/expiry worker, or route-monitoring job exists.
- Traffic coverage is an approximation (nearby stations × 250 m), not a measured
  fraction of road links. Direction/quality matching remains future work.

## Repeat checks

From `back/backend`:

```sh
uv run --python 3.12 --dev pytest tests -q
```

From `back`, with the database and BRouter running:

```sh
docker compose build backend
./scripts/db/check_integration.sh
```

The runner creates and drops its own audit database. Real provider testing is
separate and may send email:

```sh
python3 scripts/auth/check_auth_providers.py --smtp-only
```
