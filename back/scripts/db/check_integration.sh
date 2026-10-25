#!/bin/sh
# Exercise real DB and BRouter without exposing a port or sending email.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)
cd "$app_dir"
audit_db="cyclerhub_audit_$(date +%Y%m%d%H%M%S)_$$"
db_user=${POSTGRES_USER:-cyclerhub-back}
docker compose exec -T db createdb -U "$db_user" "$audit_db"
cleanup() {
  docker compose exec -T db dropdb -U "$db_user" "$audit_db"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
for migration in backend/migrations/*.sql; do
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$audit_db" < "$migration"
done
docker compose run --rm --no-deps -T \
  -v "$app_dir/backend:/audit:ro" \
  -e PYTHONPATH=/audit -e AUDIT_DATABASE="$audit_db" \
  backend python -u /audit/tests/check_integration.py
