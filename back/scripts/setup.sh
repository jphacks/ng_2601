#!/bin/sh

# Validate the protected host environment and prepare CyclerHub-back's local data paths.
# This script deliberately never installs host software. Use the Docker-compatible
# VM or engine already approved for the laptop (for example OrbStack or Docker Engine).

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
upstream_dir="${BROUTER_DIR:-$app_dir/submodule/brouter}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required for CyclerHub-back data scripts. Provision it in the protected host environment, then rerun setup.sh." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required to use the BRouter submodule. Provision it in the protected host environment, then rerun setup.sh." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "A Docker-compatible CLI is required. Start or provision OrbStack, Docker Engine, or another approved VM; setup.sh never installs it." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required in the protected Docker-compatible environment; setup.sh never installs it." >&2
  exit 1
fi

if ! git -C "$upstream_dir" rev-parse --git-dir >/dev/null 2>&1; then
  echo "BRouter submodule is not initialized at $upstream_dir. Run 'git submodule update --init --recursive' from the repository root, then rerun setup.sh." >&2
  exit 1
fi

origin=$(git -C "$upstream_dir" remote get-url origin 2>/dev/null || true)
case "$origin" in
  https://github.com/abrensch/brouter.git|https://github.com/abrensch/brouter) ;;
  *) echo "Unexpected BRouter origin: ${origin:-missing} (expected https://github.com/abrensch/brouter.git)" >&2; exit 1 ;;
esac
if [ -n "$(git -C "$upstream_dir" status --porcelain)" ]; then
  echo "Warning: BRouter upstream has local changes; CyclerHub-back does not modify or repair them." >&2
fi

mkdir -p \
  "$app_dir/brouter_extension/segments" \
  "$app_dir/data/raw/jartic" \
  "$app_dir/data/raw/npa" \
  "$app_dir/data/raw/traffic" \
  "$app_dir/data/normalized/restrictions" \
  "$app_dir/data/normalized/context"

if [ ! -f "$app_dir/backend/.env" ]; then
  ( umask 077 && cp "$app_dir/backend/.env.example" "$app_dir/backend/.env" )
  echo "Created backend/.env from backend/.env.example; replace development placeholders before starting the backend."
fi

rd5_count=$(find "$app_dir/brouter_extension/segments" -name '*.rd5' -type f -size +0c | wc -l | tr -d ' ')
if [ "$rd5_count" -eq 0 ]; then
  if [ "${DOWNLOAD_ROUTING_DATA:-1}" = "1" ]; then
    "$script_dir/data/download_rd5.sh"
  else
    echo "No RD5 data is installed. Run ./scripts/data/download_rd5.sh, or rerun setup.sh without DOWNLOAD_ROUTING_DATA=0." >&2
    exit 1
  fi
  rd5_count=$(find "$app_dir/brouter_extension/segments" -name '*.rd5' -type f -size +0c | wc -l | tr -d ' ')
fi

echo "CyclerHub-back setup is ready: $rd5_count RD5 tile(s), upstream BRouter at $upstream_dir"
