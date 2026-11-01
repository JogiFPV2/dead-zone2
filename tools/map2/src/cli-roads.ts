/**
 * `pnpm --filter @deadzone/map2 roads <raw2.json> <out.json>`: raw OSM (scripts/extract.py) →
 * road network in local metres (`deadzone-map2-roads-1`) + check report on stdout.
 * Output goes to the cache (never commit data; ODbL).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { checkNet, buildNet } from './graph.js';
import { projection, STW_ORIGIN } from './project.js';
import type { RawOsm2 } from './raw.js';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: cli-roads <raw2.json> <out.json>');
const raw = JSON.parse(readFileSync(src, 'utf8')) as RawOsm2;
const proj = projection(STW_ORIGIN);
const net = buildNet(raw, proj);
const check = checkNet(net);
const water = raw.areas.map((a) => ({
  id: a.id,
  name: a.name,
  rings: a.rings.map((r) => r.outer.map(([lon, lat]) => proj.toLocal(lon, lat))),
}));
const rivers = raw.ways
  .filter((w) => w.t.waterway === 'river' || w.t.waterway === 'canal')
  .map((w) => ({
    id: w.id,
    name: w.t.name ?? '',
    pts: w.nodes.map((n) => {
      const ll = raw.nodes[String(n)]!;
      return proj.toLocal(ll[0], ll[1]);
    }),
  }));
const rails = raw.ways
  .filter((w) => w.t.railway === 'rail')
  .map((w) => ({
    id: w.id,
    pts: w.nodes.map((n) => {
      const ll = raw.nodes[String(n)]!;
      return proj.toLocal(ll[0], ll[1]);
    }),
  }));
const places = raw.places
  .filter((p) => p.name)
  .map((p) => ({ name: p.name, kind: p.place, xy: proj.toLocal(p.lon, p.lat) }));
writeFileSync(
  out,
  JSON.stringify({
    format: 'deadzone-map2-roads-1',
    origin: STW_ORIGIN,
    attribution: '© współtwórcy OpenStreetMap',
    license: 'ODbL-1.0',
    ...net,
    water,
    rivers,
    rails,
    places,
  }),
);
console.log(JSON.stringify({ ...check, gaps: check.gaps.length, overlaps: check.overlaps.length }));
writeFileSync(out.replace(/\.json$/, '.check.json'), JSON.stringify(check));
