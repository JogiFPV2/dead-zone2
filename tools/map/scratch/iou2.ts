import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { straightenOsmMap } from '../src/world-source/straighten.js';
import { fillRings } from '../src/world-source/raster.js';
const DIR = '../../apps/game/public/osm/stw2/';
const truth = JSON.parse(readFileSync('/tmp/truth2.json', 'utf8')) as Record<string, number[][]>;
const got = new Map<string, number[][]>();
const seen = new Set<number>();
for (const f of readdirSync(DIR)) {
  if (!f.startsWith('t-')) continue;
  const t = straightenOsmMap(JSON.parse(readFileSync(DIR + f, 'utf8')), 0);
  for (const b of t.buildings) {
    const k = b.osmId ? 'r' + b.osmId : 'w' + b.id;
    if (!truth[k] || seen.has(b.gid!)) continue;
    seen.add(b.gid!);
    got.set(k, [...(got.get(k) ?? []), ...b.rings.map((r) => r.map((v) => v / 10))]);
  }
}
function mask(rings: number[][], x0: number, y0: number, w: number, h: number, s: number) {
  const m = new Uint8Array(w * h);
  fillRings(rings.map((r) => Float64Array.from(r, (v, i) => (i % 2 ? v - y0 : v - x0) * s)) as any, 0, 0, w, h, (j) => (m[j] = 1));
  return m;
}
console.error('tiles done', got.size);
writeFileSync('/tmp/got2.json', JSON.stringify(Object.fromEntries(got)));
const out: any[] = [];
for (const [ks, T] of Object.entries(truth)) {
  const F = got.get(ks);
  if (!F) { out.push({ id: ks, missing: 1, iou: 0, tileIou: 0 }); continue; }
  const all = [...T, ...F].flat();
  const xs = all.filter((_, k) => k % 2 === 0), ys = all.filter((_, k) => k % 2 === 1);
  const x0 = Math.floor(Math.min(...xs)) - 2, y0 = Math.floor(Math.min(...ys)) - 2;
  if (Math.max(...xs) - Math.min(...xs) > 1500 || Math.max(...ys) - Math.min(...ys) > 1500) { out.push({ id: ks, far: 1, iou: 0, tileIou: 0 }); continue; }
  const s = 4, w = (Math.ceil(Math.max(...xs)) + 2 - x0) * s, h = (Math.ceil(Math.max(...ys)) + 2 - y0) * s;
  const mt = mask(T, x0, y0, w, h, s), mf = mask(F, x0, y0, w, h, s);
  let I = 0, U = 0;
  for (let j = 0; j < mt.length; j++) { I += mt[j]! & mf[j]!; U += mt[j]! | mf[j]!; }
  // 1 m tiles of the game raster (centre in outline), compared at 0.25 m
  const tw = w / s, th = h / s;
  const tm = new Uint8Array(w * h);
  fillRings(F.map((r) => Float64Array.from(r, (v, i) => (i % 2 ? v - y0 : v - x0))) as any, 0, 0, tw, th, (j) => {
    const tx = j % tw, ty = (j - tx) / tw;
    for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) tm[(ty * s + a) * w + tx * s + b] = 1;
  });
  let I2 = 0, U2 = 0;
  for (let j = 0; j < mt.length; j++) { I2 += mt[j]! & tm[j]!; U2 += mt[j]! | tm[j]!; }
  out.push({ id: ks, iou: U ? I / U : 1, tileIou: U2 ? I2 / U2 : 1, rings: F.length, ringsT: T.length });
}
writeFileSync('/tmp/iou2.json', JSON.stringify(out));
const n = out.length, q = (f: (o: any) => boolean) => out.filter(f).length;
const mean = (k: string) => out.reduce((a, o) => a + o[k], 0) / n;
console.log({ n, missing: q((o) => o.missing), far: q((o) => o.far), meanIou: mean('iou'), minIou: Math.min(...out.map((o) => o.iou)),
  lt099: q((o) => o.iou < 0.99), meanTileIou: mean('tileIou'), courtLost: q((o) => o.ringsT > o.rings) });
for (const id of [359418993, 359332492, 14654513, 612282980, 165472532]) console.log(out.find((o) => o.id.slice(1) === String(id)));
