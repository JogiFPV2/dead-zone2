/**
 * `pnpm --filter @deadzone/map osm:map2-bld <stw2-osm.json> <stw-bld2.json> <out.json> [stw-land2.json]`:
 * the stw2 road map (`tools/map2` `pnpm osm`) + map2 buildings (`pnpm buildings`) → one
 * `deadzone-osm-1` file for `osm:tiles --stw2`. With the map2 land (`pnpm land`) untagged
 * buildings get their kind from POIs, amenity grounds and landuse.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { withMap2Buildings, type Map2Building } from './map2-buildings.js';
import type { Map2Land } from './map2-land.js';
import type { OsmMap } from './types.js';

const [roads, bld, out, landFile] = process.argv.slice(2);
if (!roads || !bld || !out)
  throw new Error('usage: osm:map2-bld <stw2-osm.json> <bld2.json> <out> [land2.json]');
const map = JSON.parse(readFileSync(roads, 'utf8')) as OsmMap;
const bs = (JSON.parse(readFileSync(bld, 'utf8')) as { buildings: Map2Building[] }).buildings;
const land = landFile ? (JSON.parse(readFileSync(landFile, 'utf8')) as Map2Land) : undefined;
const m = withMap2Buildings(map, bs, land);
writeFileSync(out, JSON.stringify(m));
const n = (f: (b: (typeof m.buildings)[number]) => boolean) => m.buildings.filter(f).length;
const count = (k: (b: (typeof m.buildings)[number]) => string) => {
  const c: Record<string, number> = {};
  for (const b of m.buildings) c[k(b)] = (c[k(b)] ?? 0) + 1;
  return JSON.stringify(Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1])));
};
console.log(
  `${out}: ${m.buildings.length} buildings (courtyards ${n((b) => b.rings.length > 1)}, noWall ${n((b) => !!b.noWall)}, levels from tags ${n((b) => b.levelsFrom === 'tag')}${land ? '' : ', no land: kinds from tags and size only'})`,
);
console.log(`kinds ${count((b) => b.kind)}`);
console.log(`kind from ${count((b) => b.typeFrom)}`);
