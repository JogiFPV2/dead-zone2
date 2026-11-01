#!/usr/bin/env bash
# Download the Geofabrik podkarpackie extract into the local cache (never into the repo).
#   tools/map2/scripts/fetch.sh            -> $DEADZONE_OSM_CACHE/podkarpackie-latest.osm.pbf
# Data © OpenStreetMap contributors, ODbL 1.0.
set -euo pipefail
CACHE="${DEADZONE_OSM_CACHE:-$HOME/.cache/deadzone-osm}"
mkdir -p "$CACHE"
OUT="$CACHE/podkarpackie-latest.osm.pbf"
if [[ -s "$OUT" && "${1:-}" != "--force" ]]; then echo "cached: $OUT"; exit 0; fi
curl -fL --retry 3 -o "$OUT.part" https://download.geofabrik.de/europe/poland/podkarpackie-latest.osm.pbf
mv "$OUT.part" "$OUT"
echo "$OUT"
