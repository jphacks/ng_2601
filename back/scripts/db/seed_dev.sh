#!/bin/sh

# Seed clearly labelled, non-authoritative reports for local UI/API development.
# Never run this against a production database.

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)
cd "$app_dir"

db_user=${POSTGRES_USER:-cyclerhub-back}
db_name=${POSTGRES_DB:-cyclerhub-back}

docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" <<'SQL'
INSERT INTO observations
    (id, category, location, temporal_kind, observed_at, expires_at, description, verification_state)
VALUES
    ('00000000-0000-4000-8000-000000000001', 'obstruction', ST_SetSRID(ST_MakePoint(136.881, 35.171), 4326)::geography, 'temporary', now(), now() + interval '7 days', 'Development seed: temporary obstruction example', 'unverified')
ON CONFLICT (id) DO UPDATE
SET observed_at = EXCLUDED.observed_at,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

INSERT INTO observations
    (id, category, location, temporal_kind, observed_at, expires_at, description, verification_state)
VALUES
    ('00000000-0000-4000-8000-000000000002', 'surface', ST_SetSRID(ST_MakePoint(136.895, 35.178), 4326)::geography, 'permanent', now(), NULL, 'Development seed: difficult surface example', 'unverified')
ON CONFLICT (id) DO NOTHING;
SQL

echo "Development observation seed is present. These reports are synthetic and must not be shown as real conditions."
