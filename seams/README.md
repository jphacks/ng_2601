# CoreS3 road-surface prototype

The PlatformIO project is [M5StackS3](M5StackS3/). It records candidate bumps and roughness from the CoreS3 IMU, tags them with fixes from the attached GPS SMA unit, and sends one event at a time to CyclerHub over Wi-Fi. It does not need a microSD card. It does not store the full acceleration stream.

## Prepare CyclerHub

1. Start the backend and database using the instructions in `../back/README.md`.
2. From `../back`, run `./scripts/db/migrate.sh`. Migration 004 creates the device-event table on an existing database; a fresh database runs it during initialization.
3. Set `DEVICE_INGEST_TOKEN` to a long random string in `../back/backend/.env`, then restart the backend. Use the same string on the device. Do not use a user or moderator token.

The backend accepts `POST /v1/device-events` and includes experimental measurements in `GET /v1/map-data` under `route_context.surface`. These events are unverified and do not change route selection.

To see them in the frontend, set `VITE_API_MODE=http` and `VITE_API_BASE_URL=http://localhost:8080` in `../frontend/.env.local` (see `../frontend/.env.example`), then start the frontend. The browser reloads map data periodically while the live API mode is active. Its default mock mode will not show uploaded measurements.

## Configure and upload the CoreS3

1. Copy `M5StackS3/include/device_config.example.h` to `M5StackS3/include/device_config.h`. This local file is ignored by Git.
2. Set the Wi-Fi SSID/password, `CYCLERHUB_DEVICE_TOKEN`, and a stable `CYCLERHUB_DEVICE_ID`. Set `CYCLERHUB_INGEST_URL` to the backend address reachable from the CoreS3. `localhost` on the CoreS3 does **not** mean the laptop. On a local LAN, use the laptop's LAN IP and port 8080.
3. For local LAN HTTP testing only, set `CYCLERHUB_ALLOW_HTTP` to `1`. The token is visible to other devices on that network. For HTTPS, leave HTTP disabled and set `CYCLERHUB_SERVER_CA_CERT` to the trusted root CA PEM for the server certificate. Certificate verification stays enabled.
4. Plug the GPS SMA unit into CoreS3 Port C with its antenna attached. The firmware uses UART RX GPIO 18 and TX GPIO 17 and defaults to 115200 baud. Change `CYCLERHUB_GPS_BAUD` if the actual unit differs. M5Stack's published Unit GPS SMA documentation lists AT6668; verify the model/baud on your AT6669-labelled hardware before a ride.
5. Open `M5StackS3/` as the PlatformIO project. Build with `pio run -d M5StackS3`, then upload with PlatformIO while the CoreS3 is connected by USB.

Outdoors, wait for `GPS: READY`, then tap the screen to switch to `RECORDING`. The firmware requires a recent GPS position and UTC time, HDOP at most 5, and speed at least 3 km/h before creating an event. Tap again to pause. The screen reports Wi-Fi and queue state; the serial monitor reports upload errors.

Events are written to the CoreS3's **internal flash** queue before upload and removed after the backend responds with HTTP 201. If Wi-Fi is absent, reconnect on the same network later with the device powered on. On first use, mounting LittleFS may format its dedicated filesystem partition; save any existing files in that partition before flashing this firmware. Internal flash is finite, so this queue is for event summaries, not continuous raw IMU recording.

For HTTPS uploads, the firmware sets its clock from GPS time or network time before verifying the server certificate. If neither time source is available, events remain queued until a valid time is obtained.

The bump/roughness thresholds are prototype values in `src/main.cpp`. Data collection on the physical CoreS3 has been confirmed. Bicycle mounting, tire pressure, speed, and GPS reception all affect results. Detection accuracy and on-road behavior have not yet been validated; check against known locations before treating map points as road conditions.
