# CoreS3 Wi-Fi road-surface prototype

## Metadata

- Updated: 2026-10-25
- Issue / PR: none created; team review is pending.
- Branch: local `main` working tree, base commit `3225607`.
- Working Tree: uncommitted changes in `seams/`, `back/backend/`, and `frontend/`. The rename from tracked `M5Stack/` to untracked `seams/`, `seams.code-workspace`, and untracked backend docs existed before this implementation; preserve them.
- Status: code ready for review; hardware and live network tests remain.

## Objective

Send CoreS3 IMU bump/roughness candidates with GPS time and position to CyclerHub using Wi-Fi, with no microSD card.

## Changes

- Replaced the SD CSV firmware with M5Unified, TinyGPSPlus, event detection, an internal LittleFS queue, and authenticated Wi-Fi upload.
- Added `POST /v1/device-events`, migration `004_device_surface_events.sql`, and an experimental `route_context.surface` map collection.
- Added frontend rendering for unverified device measurements, retaining the distinction from community reports and official data. Live map data refreshes every minute.

## Design Decisions

- One event per request; `device_id + event_id` deduplicates retries. One shared ingest token is a prototype mechanism, not a full device registration system.
- The backend stores candidate events separately from `observations` and gives them no routing effect.
- The CoreS3 queues event summaries in internal flash; raw acceleration is not retained. LittleFS mount may format its filesystem partition on first use.
- GPS UART is configured for CoreS3 Port C at 115200 baud by default. The user's reported AT6669 marking needs on-device confirmation; M5Stack publishes AT6668 specifications for Unit GPS SMA.

## Verification

- `pio run -d seams/M5StackS3` passed for the M5Stack CoreS3.
- Backend `pytest`: 16 passed. Ingest auth, validation, retries, and map source behavior have focused tests.
- Frontend `npm run typecheck`, `npm test` (51 passed), and `npm run build` passed in a disposable Node container; no host Node installation was needed.
- Applied migration 004 to the local running PostgreSQL; table exists and contains zero events.
- Not tested: physical GPS, Wi-Fi upload, flash persistence across power loss, live map display with a real ride.

## Next Actions

1. Review the new additive API and frontend measurement category with the backend/frontend owners before merging.
2. Set a long `DEVICE_INGEST_TOKEN` in `back/backend/.env`; create the ignored `seams/M5StackS3/include/device_config.h` from the example with Wi-Fi, endpoint, and the same token.
3. Confirm the actual GPS module baud/pin behavior via the serial monitor and validate outdoors before a ride.
4. Flash the CoreS3, test offline/reconnect upload, and confirm the point appears in live API mode on the map.
5. Calibrate bump and roughness thresholds on known roads; review location privacy and a production device-auth scheme before public use.

## References

- [Firmware setup](../../../seams/README.md)
- [Backend API](../../../back/docs/api.md#experimental-cores3-road-surface-measurements)
- [Frontend API contract](../api-contract.md)
