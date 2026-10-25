# Environment setup

For the backend's API and data sources, see [api.md](api.md) and [external-data.md](external-data.md).
Set the directory as follows:
```txt
.
└── back
    └── submodule/brouter
```
Keep at least 1 GB free for the Japan RD5 data; the current set is about 501 MB. (updated weekly)

## Dependencies
- Git
- Docker-compatible CLI with Compose v2
- Python 3
- BRouter

## Prerequisites
```bash
cd back
./scripts/setup.sh
```

`back/scripts/setup.sh`:
- Validates the protected prerequisites
- Verifies the initialized BRouter submodule at `back/submodule/brouter`; initialize it first with `git submodule update --init --recursive`
- Creates data directories
- Downloads the current Japan RD5 set when no tile is present. set `DOWNLOAD_ROUTING_DATA=0` to validate without downloading.

## Download JARTIC data
Repeat the download and conversion after each monthly JARTIC release.
```bash
python3 scripts/data/download_jartic.py
python3 scripts/parse/import_jartic.py data/raw/jartic/typeD_aichi.zip
```

`python3 scripts/data/download_jartic.py`:
- Downloads the current Aichi JARTIC archive
- The default is Aichi (`R23`)
- Add a flag `--all` for all prefectures

`python3 scripts/parse/import_jartic.py data/raw/jartic/typeD_aichi.zip`:
- Convert the downloaded archive
- Write `data/normalized/restrictions/jartic.geojson` (read-only)


## Start services
```bash
./scripts/launch.sh
curl --fail http://localhost:8080/health # for confirmation
```
- Waits for the backend health endpoint and reports a useful Compose-log command if startup fails
- The backend would be available at `http://localhost:8080`
- BRouter would be private to the Compose network at `http://brouter:17777`

### Authentication configuration

From `back/`, copy the example and edit the local file:

```sh
cp backend/.env.example backend/.env
```

`setup.sh` also copies the example when `.env` is absent. Keep `.env` out of Git. Set `SESSION_SECRET` to at least 32 random characters before starting. Add credentials only for the features you use:

| Feature | Add to `backend/.env` |
| --- | --- |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the exact registered `GOOGLE_CALLBACK_URL`; set `FRONTEND_ORIGIN` to the browser's origin. |
| Email magic links | `SMTP_USERNAME` (full account), `SMTP_PASSWORD` (app password), and an approved `SMTP_SENDER`. The example's Gmail host, port 587, TLS, and required authentication are defaults; change them for your provider. |
| Workspace IP-authorized SMTP relay | Set the approved relay host and sender, TLS, and `SMTP_AUTH_MODE=auto` or `none` only after its source IP is allowlisted. |
| Moderation API | Set a long random `MODERATOR_API_TOKEN`. |
| CoreS3 uploads | Set a separate long random `DEVICE_INGEST_TOKEN`. |

`SMTP_TEST_RECEIVER` is used only by the manual provider check; magic links go to the requesting user. See [.env.example](../backend/.env.example) for all available keys and defaults.

## Tests / Checks
```bash
cd backend
uv run --python 3.12 --dev pytest tests -q
```
Run this from `back/` to check configured authentication providers manually:

```sh
python3 scripts/auth/check_auth_providers.py
```

The script opens a Google authorization flow when credentials are configured. If OAuth is unavailable or fails, it sends one labelled email to `SMTP_TEST_RECEIVER`; use `--smtp-only` to check only email. Set the receiver before that check. Automated tests do not contact Google or send email. `uv` is needed for development tests; Docker installs runtime dependencies in its image.

For repeatable integration checks, start `db` and `brouter`, build the backend image, then run `./scripts/db/check_integration.sh` from `back/`. It creates and drops a disposable `cyclerhub_audit_*` database and does not bind a host port. SMTP delivery and Google's remote exchange are intercepted in that harness; use the separate provider smoke test for live email or authorization.

Run `./scripts/db/migrate.sh` when upgrading an existing database volume. Compose initialization runs only when a new volume is created.

## Tunnel

When remote access is needed, install `cloudflared` separately and run `cloudflared tunnel --url http://localhost:8080`. Keep the tunnel command outside `launch.sh` because tunnel credentials, exposure, and lifecycle belong to the laptop operator rather than the routing service.

## Stop
```bash
cd back
docker compose down --remove-orphans
```

### Remove
```bash
docker compose down --remove-orphans

docker image rm cyclerhub-back-backend cyclerhub-back-brouter:local

find brouter_extension/segments -type f \( -name '*.rd5' -o -name '*.part' -o -name 'manifest.tsv' -o -name 'manifest.tsv.tmp' \) -delete

find data/raw -type f -delete

rm -f data/normalized/restrictions/*.geojson data/normalized/context/*.geojson .cyclerhub-back-build-fingerprint

rm -rf backend/.venv backend/.pytest_cache

find backend scripts -type d -name __pycache__ -prune -exec rm -rf {} +
```
