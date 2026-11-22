/**
 * `pnpm --filter @deadzone/map2 land <land-raw2.json> <out.json>`: raw OSM ground
 * (scripts/extract_land.py) → map2 land 1:1 in local metres (`deadzone-map2-land-1`) + stats on
 * stdout. Output goes to the cache (never commit data; ODbL).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildLand, type RawLand2 } from './land.js';
import { projection, STW_ORIGIN } from './project.js';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: cli-land <land-raw2.json> <out.json>');
const raw = JSON.parse(readFileSync(src, 'utf8')) as RawLand2;
const proj = projection(STW_ORIGIN);
const land = buildLand(raw, proj);
const by = (xs: { tags: Record<string, string> }[], keys: string[]) => {
  const m: Record<string, number> = {};
  for (const x of xs) {
    const k = keys.map((key) => (x.tags[key] ? `${key}=${x.tags[key]}` : '')).find(Boolean) ?? '?';
    m[k] = (m[k] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
  );
};
console.log(
  JSON.stringify({
    areas: land.areas.length,
    holes: land.areas.reduce((s, a) => s + a.inner.length, 0),
    lines: land.lines.length,
    nodes: land.nodes.length,
    topAreas: by(land.areas, ['natural', 'landuse', 'leisure', 'amenity']),
    topLines: by(land.lines, ['waterway', 'railway', 'power', 'natural', 'barrier']),
  }),
);
writeFileSync(
  out,
  JSON.stringify({
    format: 'deadzone-map2-land-1',
    origin: proj.origin,
    attribution: '© współtwórcy OpenStreetMap',
    license: 'ODbL-1.0',
    ...land,
  }),
);
