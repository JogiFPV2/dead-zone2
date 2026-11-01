/**
 * `pnpm --filter @deadzone/map2 buildings <bld-raw2.json> <out.json>`: raw OSM buildings
 * (scripts/extract_buildings.py) → map2 buildings 1:1 in local metres (`deadzone-map2-buildings-1`)
 * + stats on stdout. Output goes to the cache (never commit data; ODbL).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildBuildings, type RawBuildings2 } from './buildings.js';
import { projection, STW_ORIGIN } from './project.js';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: cli-buildings <bld-raw2.json> <out.json>');
const raw = JSON.parse(readFileSync(src, 'utf8')) as RawBuildings2;
const proj = projection(STW_ORIGIN);
const buildings = buildBuildings(raw, proj);
const count = (f: (b: (typeof buildings)[number]) => boolean) => buildings.filter(f).length;
const from: Record<string, number> = {};
for (const b of buildings) from[b.heightFrom] = (from[b.heightFrom] ?? 0) + 1;
console.log(
  JSON.stringify({
    buildings: buildings.length,
    vertices: buildings.reduce((s, b) => s + b.outer.length, 0),
    courtyards: count((b) => b.inner.length > 0),
    withParts: count((b) => b.parts.length > 0),
    withSharedWalls: count((b) => b.shared.length > 0),
    heightFrom: from,
  }),
);
writeFileSync(
  out,
  JSON.stringify({
    format: 'deadzone-map2-buildings-1',
    origin: proj.origin,
    attribution: '© współtwórcy OpenStreetMap',
    license: 'ODbL-1.0',
    buildings,
  }),
);
