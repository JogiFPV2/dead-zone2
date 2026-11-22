/**
 * `pnpm --filter @deadzone/map osm:map2-bld <stw2-osm.json> <stw-bld2.json> <out.json>`: the stw2
 * road map (`tools/map2` `pnpm osm`) + map2 buildings (`pnpm buildings`) → one `deadzone-osm-1`
 * file for `osm:tiles --stw2`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { withMap2Buildings, type Map2Building } from './map2-buildings.js';
import type { OsmMap } from './types.js';

const [roads, bld, out] = process.argv.slice(2);
if (!roads || !bld || !out)
  throw new Error('usage: osm:map2-bld <stw2-osm.json> <bld2.json> <out>');
const map = JSON.parse(readFileSync(roads, 'utf8')) as OsmMap;
const bs = (JSON.parse(readFileSync(bld, 'utf8')) as { buildings: Map2Building[] }).buildings;
const m = withMap2Buildings(map, bs);
writeFileSync(out, JSON.stringify(m));
const n = (f: (b: (typeof m.buildings)[number]) => boolean) => m.buildings.filter(f).length;
console.log(
  `${out}: ${m.buildings.length} buildings (courtyards ${n((b) => b.rings.length > 1)}, noWall ${n((b) => !!b.noWall)}, levels from tags ${n((b) => b.levelsFrom === 'tag')})`,
);
