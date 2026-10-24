# Environment Setup
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
- Verifies or clones the unmodified BRouter repository at `back/submodule/brouter`
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

The backend reads secrets from `backend/.env` through Compose's `env_file`. `setup.sh` creates that file from the checked-in `backend/.env.example` when it is missing. Replace its development placeholders before exposing the service, and do not commit `backend/.env`.

For email sign-in, set `SMTP_HOST=smtp-relay.gmail.com`, `SMTP_PORT=587`, the Google Workspace `SMTP_USERNAME` allowed to use SMTP AUTH, its app-password in `SMTP_PASSWORD`, and the approved visible `SMTP_SENDER`. The sender may differ from the SMTP AUTH account when the Workspace relay policy allows it.

Google sign-in can remain on dummy values for local development. Before enabling it, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the exact registered `GOOGLE_CALLBACK_URL`. Set `FRONTEND_ORIGIN` to the browser origin that receives the sign-in response. Use long random values for `SESSION_SECRET` and `MODERATOR_API_TOKEN` before exposing the laptop through Cloudflare Tunnel.

The moderator token is checked only by the backend moderation endpoint; it is not stored in PostgreSQL or sent to the frontend.


## Tests
```bash
cd backend
uv run --python 3.12 --with pytest pytest tests -q
```
NOTE: `uv` is only needed for development tests since the runtime backend dependencies are installed inside the Docker image.

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