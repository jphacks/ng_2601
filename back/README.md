# CyclerHub-back routing backend

`cyclerhub-back` is our application code. `submodule/brouter` is the initialized, unmodified BRouter submodule built as a dependency by Compose.

## Run locally

```sh
./scripts/setup.sh
./scripts/launch.sh
```

The setup script validates the protected Docker-compatible environment, verifies the initialized BRouter submodule, creates external-data directories, and downloads the Japan RD5 data when it is absent. It never installs host software or clones BRouter. The launch script validates the environment and starts the backend and BRouter containers with Docker's cache-aware build behavior.

Run `./scripts/setup.sh` when recovering a laptop or after changing the dependency location. Run `./scripts/launch.sh` whenever you want the local service; it calls setup first, builds only when its fingerprint detects missing or changed inputs, and then starts the containers.

For configuration and operating steps, see [environment.md](docs/environment.md). For data sources and routing roles, see [external-data.md](docs/external-data.md).

Request a route:

```sh
curl -X POST http://localhost:8080/v1/routes \
  -H 'Content-Type: application/json' \
  -d '{"bike_type":"city","start":{"lat":35.170,"lon":136.880},"end":{"lat":35.180,"lon":136.900}}'
```

The backend is the only public service. BRouter is available only on the Compose network.

`GET /v1/routing-options` lists the bike types and user-selectable values. `GET /v1/routing-sources` reports loaded external sources and whether PostgreSQL preferences are available. `POST /v1/routes` can use the authenticated user's saved default bike and preferences; explicit request preferences always override saved preferences.

Authentication endpoints are under `/v1/auth`: use `GET /google` for the Google authorization URL, or `POST /magic-link/request` and `POST /magic-link/consume` for email sign-in. Access tokens are short-lived JWTs and refresh tokens are rotated and stored only as hashes. `GET /v1/auth/me` and `PUT /v1/auth/me/preferences` manage the user's single default mobility profile.

The internal moderation tool uses `PATCH /v1/moderation/observations/{observation_id}` with a bearer token from `MODERATOR_API_TOKEN`. It has no user-facing moderator account or database table.

## BRouter dependency

BRouter is the upstream project at [github.com/abrensch/brouter](https://github.com/abrensch/brouter). Keep its initialized submodule at `submodule/brouter`; run `git submodule update --init --recursive` from the repository root before running `setup.sh`. The setup script refuses to continue if the checkout is missing or has a different origin. CyclerHub-back profiles are mounted read-only into the dependency container, and the upstream checkout is never edited by this project.

The Compose build uses `submodule/brouter` as its build context, so no fork is required. A fresh laptop initializes the dependency with `git submodule update --init --recursive`; `./scripts/setup.sh` only validates it and prepares the remaining local data.

Inside Compose, the backend refers to BRouter as `http://brouter:17777`. BRouter is intentionally not mapped to a host port, so the frontend uses `http://localhost:8080` and never depends on BRouter's internal URL. For diagnostics, use `docker compose logs brouter` or `docker compose exec brouter ...` rather than adding a public BRouter endpoint.

## Registration points

- `config/routing_catalog.json`: bike types, supported user preferences, defaults, BRouter parameter mappings, and each bike type's ruleset.
- `brouter_extension/profiles/*.brf`: our profiles, mounted read-only into BRouter's profile directory.
- `brouter_extension/segments/*.rd5`: downloaded BRouter routing data, mounted read-only as `/segments4`; these are generated external files, not our profiles or a modified BRouter checkout.
- `scripts/data/`: downloads external routing and government data.
- `scripts/parse/`: converts downloaded government archives into the normalized restriction overlay.
- `scripts/auth/check_auth_providers.py`: operator-only Google OAuth check with an SMTP relay test fallback.

`backend/app/context.py` is the database boundary. `PostgresUserPreferenceStore` reads the user's single default bike and preference set from PostgreSQL, while the empty store remains available when `DATABASE_URL` is not configured.

The catalog and `.brf` file have different roles. The catalog's `bike_types` entries are the user-facing mobility profiles (`city`, `electric_assist`, `road`, `gravel`, and `mamachari`). Their `brouter_profile` field selects the BRouter implementation. All currently use the parameterized `brouter_extension/profiles/japan_bicycle.brf`; their physical differences are supplied as request parameters from each catalog entry. Add a separate `.brf` file only when the routing logic itself differs, rather than copying the file for every bicycle type.

The JARTIC restriction provider is loaded from its normalized
GeoJSON file when it exists. Traffic volume and NPA accident snapshots
are separate route-context providers. Restrictions can discard a candidate
only when an imported record is an explicit hard block; traffic can rank
alternatives only with adequate coverage; accident history and database-backed
observations are returned as context and do not alter routing. When restrictions
or traffic are enabled, the backend asks BRouter for up to three alternatives.

[external-data.md](docs/external-data.md) records the governmental source choices, their routing roles, refresh procedures, and the next safe JARTIC mappers.

[database-schema.md](docs/database-schema.md) describes the PostgreSQL/PostGIS schema, Google sign-in and Google SMTP magic-link fallback, and the boundary between database data and local external-data snapshots.

[api.md](docs/api.md) is the backend API contract. The frontend is in the sibling `../frontend/` directory.
