#!/bin/sh

# Recover the local CyclerHub-back environment and start the backend and BRouter services.

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
build_stamp="$app_dir/.cyclerhub-back-build-fingerprint"

# Check the engine before setup can trigger a large RD5 download. This keeps a
# stopped VM failure fast and avoids downloading data that cannot be used yet.
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "The Docker-compatible engine is not running. Start OrbStack, Docker Engine, or another approved VM, then rerun launch.sh." >&2
  exit 1
fi

"$script_dir/setup.sh"
cd "$app_dir"

docker compose config --quiet

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1"
  else
    sha256sum "$1"
  fi
}

current_fingerprint=$(
  {
    find backend config brouter_extension/profiles -type f -print | sort | while IFS= read -r file; do hash_file "$file"; done
    hash_file compose.yaml
    git -C "$app_dir/submodule/brouter" rev-parse HEAD
    git -C "$app_dir/submodule/brouter" status --porcelain
  } | hash_file /dev/stdin | awk '{print $1}'
)

build_required=0
if ! docker image inspect cyclerhub-back-backend >/dev/null 2>&1 || ! docker image inspect cyclerhub-back-brouter:local >/dev/null 2>&1; then
  build_required=1
elif [ ! -f "$build_stamp" ] || [ "$(cat "$build_stamp")" != "$current_fingerprint" ]; then
  build_required=1
fi

if [ "$build_required" -eq 1 ]; then
  docker compose up -d --build
  printf '%s\n' "$current_fingerprint" > "$build_stamp"
else
  docker compose up -d
fi

if command -v curl >/dev/null 2>&1; then
  attempt=1
  while [ "$attempt" -le 30 ]; do
    if curl --fail --silent http://localhost:8080/health >/dev/null 2>&1; then
      echo "CyclerHub-back health check passed."
      break
    fi
    if [ "$attempt" -eq 30 ]; then
      echo "Containers started but the backend did not become healthy. Inspect: docker compose logs --tail=100 backend brouter" >&2
      exit 1
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
else
  echo "curl is unavailable; containers started, but health was not checked." >&2
fi

echo "CyclerHub-back is running at http://localhost:8080"
echo "Health check: curl --fail http://localhost:8080/health"
