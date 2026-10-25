#!/bin/sh

# Apply migrations to the Compose PostgreSQL service. The initial Compose
# bootstrap already runs 001 and 002 on a fresh volume; this tracker makes the
# command safe for both fresh and existing prototype databases.

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)
cd "$app_dir"

db_user=${POSTGRES_USER:-cyclerhub-back}
db_name=${POSTGRES_DB:-cyclerhub-back}

docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (version) VALUES ('001_initial.sql')
ON CONFLICT (version) DO NOTHING;
SQL

for migration in "$app_dir"/backend/migrations/*.sql; do
  version=$(basename "$migration")
  [ "$version" = "001_initial.sql" ] && continue
  applied=$(docker compose exec -T db psql -At -U "$db_user" -d "$db_name" -c "SELECT 1 FROM schema_migrations WHERE version = '$version'")
  if [ "$applied" = "1" ]; then
    echo "already applied  $version"
    continue
  fi
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" < "$migration"
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" -c "INSERT INTO schema_migrations (version) VALUES ('$version')"
  echo "applied  $version"
done
