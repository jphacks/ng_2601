#!/bin/sh

# Download the BRouter .rd5 tiles that intersect Japan, including remote islands.
# The BRouter server only publishes tiles containing routing data, so this script
# resolves the current official directory index before downloading anything.
#
# Usage:
#   ./scripts/data/download_rd5.sh
#   ./scripts/data/download_rd5.sh --refresh
#   ./scripts/data/download_rd5.sh --dry-run

set -eu

case "${1:-}" in
  "") refresh=0; dry_run=0 ;;
  --refresh) refresh=1; dry_run=0 ;;
  --dry-run) refresh=0; dry_run=1 ;;
  *) echo "Usage: $0 [--refresh|--dry-run]" >&2; exit 2 ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# This script is two levels below the project root: back/scripts/data.
app_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)
destination="${SEGMENTS_DIR:-$app_dir/brouter_extension/segments}"
base_url="${BROUTER_SEGMENTS_URL:-https://brouter.de/brouter/segments4}"
index_url="${BROUTER_SEGMENTS_INDEX_URL:-$base_url/}"
manifest="$destination/manifest.tsv"
index_file=$(mktemp "${TMPDIR:-/tmp}/cyclerhub-back-rd5-index.XXXXXX")
manifest_tmp=""

cleanup() {
  rm -f "$index_file"
  if [ -n "$manifest_tmp" ]; then rm -f "$manifest_tmp"; fi
}
trap cleanup EXIT INT TERM

curl --fail --location --retry 3 --retry-delay 2 --connect-timeout 20 \
  --silent --show-error --output "$index_file" "$index_url"

# 5 by 5 degree BRouter tiles intersecting Japanese territory. The index filter
# removes cells without data, preventing 404s for ocean-only tiles.
tiles=$(awk '
  /href="E(120|125|130|135|140|145|150|155)_N(15|20|25|30|35|40|45)\.rd5"/ {
    name = $0
    sub(/.*href="/, "", name)
    sub(/".*/, "", name)
    print name
  }
' "$index_file" | sort -u | sed 's/\.rd5$//')

if [ -z "$tiles" ]; then
  echo "No Japan tiles found in BRouter segment index: $index_url" >&2
  exit 1
fi

if [ "$dry_run" -eq 1 ]; then
  printf '%s\n' "$tiles" | sed "s#^#$base_url/#; s#\$#.rd5#"
  exit 0
fi

mkdir -p "$destination"
manifest_tmp="$manifest.tmp"
printf 'tile\tsource\tdownloaded_at_utc\n' > "$manifest_tmp"

total_tiles=$(printf '%s\n' "$tiles" | wc -l | tr -d ' ')
tile_index=0

for tile in $tiles; do
  tile_index=$((tile_index + 1))
  target="$destination/$tile.rd5"
  url="$base_url/$tile.rd5"
  if [ "$refresh" -eq 0 ] && [ -s "$target" ]; then
    printf '[%s/%s] %s already present\n' "$tile_index" "$total_tiles" "$tile.rd5"
    printf '%s\t%s\t%s\n' "$tile" "$url" "existing" >> "$manifest_tmp"
    continue
  fi

  temporary="$target.part"
  rm -f "$temporary"
  printf '[%s/%s] Downloading %s\n' "$tile_index" "$total_tiles" "$tile.rd5"
  speed_bytes=$(curl --fail --location --retry 3 --retry-delay 2 --connect-timeout 20 \
    --progress-bar --output "$temporary" --write-out '%{speed_download}' "$url")
  if [ ! -s "$temporary" ]; then
    echo "Downloaded file is empty: $url" >&2
    rm -f "$temporary"
    exit 1
  fi
  mv "$temporary" "$target"
  speed_mib=$(awk -v bytes="$speed_bytes" 'BEGIN { printf "%.1f MiB/s", bytes / 1048576 }')
  printf '[%s/%s] Finished %s (%s)\n' "$tile_index" "$total_tiles" "$tile.rd5" "$speed_mib"
  printf '%s\t%s\t%s\n' "$tile" "$url" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$manifest_tmp"
done

mv "$manifest_tmp" "$manifest"
manifest_tmp=""
echo "Japan segment set is ready in $destination"
