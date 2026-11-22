/**
 * `pnpm --filter @deadzone/map osm:map2-land <stw2-osm.json> <stw-land2.json> <out.json>`: the
 * stw2 map (roads, buildings: `osm:map2-bld`) + map2 ground (`tools/map2` `pnpm land`) → one
 * `deadzone-osm-1` file for `osm:tiles --stw2`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { withMap2Land, type Map2Land } from './map2-land.js';
import type { OsmMap } from './types.js';

const [base, landFile, out] = process.argv.slice(2);
if (!base || !landFile || !out)
  throw new Error('usage: osm:map2-land <stw2-osm.json> <land2.json> <out>');
const map = JSON.parse(readFileSync(base, 'utf8')) as OsmMap;
const land = JSON.parse(readFileSync(landFile, 'utf8')) as Map2Land;
const r = withMap2Land(map, land);
writeFileSync(out, JSON.stringify(r.map));
console.log(`${out}: ${JSON.stringify(r.stats)}`);
