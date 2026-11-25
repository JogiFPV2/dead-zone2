import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { OsmBuilding, OsmMap } from '../osm/types.js';
import { alignBuildingsToGrid, type GridAlignStats } from './grid-align.js';
import { STW2_SPLITS } from './landmarks.js';
import { OSM_TILE_SIZE, type OsmTileManifest } from './tiles.js';

/**
 * `pnpm --filter @deadzone/map osm:stw2-align <tiles-dir>`: every building of the stw2 tiles
 * turned onto one grid (Paweł 25.11: all buildings at one angle, as in Project Zomboid, even
 * where the real one stands askew). Runs `alignBuildingsToGrid` once over the whole map (merged
 * tiles, features deduplicated by id) and writes the turned outlines back into every tile that
 * holds the building; manifest hashes are recomputed. Roads stay as they are.
 */
const dir = process.argv[2];
if (!dir) {
  console.error('usage: osm:stw2-align <tiles-dir>');
  process.exit(2);
}
const t0 = performance.now();
const manifestPath = join(dir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as OsmTileManifest & {
  dataHash?: string;
  kinds: unknown;
};
const read = (file: string) =>
  JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString('utf8')) as OsmMap;
const tiles = new Map(manifest.tiles.map((r) => [r.file, read(r.file)]));
type WithId = { id: number };
const uniq = <T extends WithId>(key: keyof OsmMap): T[] => {
  const seen = new Map<number, T>();
  for (const t of tiles.values())
    for (const f of (t[key] as unknown as T[] | undefined) ?? [])
      if (!seen.has(f.id)) seen.set(f.id, f);
  return [...seen.values()];
};
const first = tiles.values().next().value as OsmMap;
const merged: OsmMap = {
  ...first,
  roads: uniq('roads'),
  rails: uniq('rails'),
  ...(first.power ? { power: uniq('power') } : {}),
  waterways: uniq('waterways'),
  areas: [],
  buildings: uniq<OsmBuilding>('buildings').sort((a, b) => (a.gid ?? 0) - (b.gid ?? 0)),
  trees: [],
  treeRows: [],
  pois: [],
};
const stats = {} as GridAlignStats;
// Split buildings keep their real outline: their cut line is fixed in raw coordinates.
const keep = new Set(Object.keys(STW2_SPLITS).map(Number));
const aligned = alignBuildingsToGrid(merged, 0, stats, { all: true, keep });
const ringsOf = new Map(aligned.buildings.map((b) => [b.id, b.rings]));
console.log(`buildings ${merged.buildings.length}, ${JSON.stringify(stats)}`);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
for (const ref of manifest.tiles) {
  const t = tiles.get(ref.file)!;
  t.buildings = t.buildings.map((b) => ({ ...b, rings: ringsOf.get(b.id) ?? b.rings }));
  const body = JSON.stringify(t);
  writeFileSync(join(dir, ref.file), gzipSync(body, { level: 9 }));
  ref.bytes = body.length;
  ref.sha256 = sha(body);
}
manifest.dataHash = sha(
  JSON.stringify({
    tiles: manifest.tiles.map((r) => r.sha256),
    places: manifest.places,
    kinds: manifest.kinds,
    OSM_TILE_SIZE,
  }),
);
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
