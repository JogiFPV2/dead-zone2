import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OsmMap } from '../osm/types.js';
import { alignBuildingsToGrid, type GridAlignStats } from './grid-align.js';
import { OSM_ROTATION_DEG, OSM_WORLD_SIZE } from './straighten.js';
import {
  OSM_TILES_FORMAT,
  OSM_TILE_SIZE,
  packKinds,
  splitOsmMap,
  type OsmTileManifest,
  type OsmTileRef,
} from './tiles.js';

/**
 * `pnpm --filter @deadzone/map osm:tiles <stw-map.json> <out-dir>`: the whole OSM square as
 * lazily loaded tiles (`manifest.json` + `t-<x>-<y>.json`, see `tiles.ts`). ODbL data: every
 * tile keeps the attribution and licence fields.
 */
const args = process.argv.slice(2);
/** `--stw2`: map2 data (`?map=stw2`): north up (no rotation, no grid align), 32 768 m world. */
const stw2 = args.includes('--stw2');
const [input, outDir] = args.filter((a) => !a.startsWith('--'));
const ROT = stw2 ? 0 : OSM_ROTATION_DEG;
const WORLD = stw2 ? 32768 : OSM_WORLD_SIZE;
if (!input || !outDir) {
  console.error('usage: osm:tiles <stw-map.json> <out-dir> [--stw2]');
  process.exit(2);
}
const t0 = performance.now();
// Buildings off the street grid turned onto it once, with the whole map in view (`grid-align.ts`).
const align = {} as GridAlignStats;
const raw = JSON.parse(readFileSync(input, 'utf8')) as OsmMap;
const map = stw2 ? raw : alignBuildingsToGrid(raw, OSM_ROTATION_DEG, align);
console.log(`grid align: ${JSON.stringify(align)}`);
const { tiles, kinds } = splitOsmMap(map, { rotationDeg: ROT, worldSize: WORLD });
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const refs: OsmTileRef[] = [];
const keys = [...tiles.keys()].sort((a, b) => {
  const [ax, ay] = a.split(',').map(Number);
  const [bx, by] = b.split(',').map(Number);
  return ay! - by! || ax! - bx!;
});
let total = 0;
for (const k of keys) {
  const [tx, ty] = k.split(',').map(Number) as [number, number];
  const body = JSON.stringify(tiles.get(k));
  const file = `t-${tx}-${ty}.json`;
  writeFileSync(join(outDir, file), body);
  refs.push({ tx, ty, file, bytes: body.length, sha256: sha(body) });
  total += body.length;
}
const packed = packKinds(kinds);
const places = map.places;
const dataHash = sha(
  JSON.stringify({ tiles: refs.map((r) => r.sha256), places, kinds: packed, OSM_TILE_SIZE }),
);
const manifest: OsmTileManifest = {
  format: OSM_TILES_FORMAT,
  crs: map.crs,
  E0: map.E0,
  N1: map.N1,
  size: map.size,
  attribution: map.attribution,
  license: map.license,
  source: map.source,
  worldSize: WORLD,
  rotationDeg: ROT,
  ...(stw2 ? { id: 'stw2', start: { x: 17000, y: 19000 } } : {}),
  tileSize: OSM_TILE_SIZE,
  places,
  kinds: packed,
  tiles: refs,
  dataHash,
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest));
console.log(
  `${outDir}: ${refs.length} tiles, ${(total / 1e6).toFixed(1)} MB, max ${(Math.max(...refs.map((r) => r.bytes)) / 1e6).toFixed(2)} MB, kinds ${packed.length} B, ${((performance.now() - t0) / 1000).toFixed(1)} s, hash ${dataHash.slice(0, 12)}`,
);
