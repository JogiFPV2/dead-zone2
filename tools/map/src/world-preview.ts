/**
 * Dev: renders the world plan top-down to PNG for review (no game data is written).
 *   pnpm --filter @deadzone/map exec tsx src/world-preview.ts [seed] [size] [outDir] [prefix]
 * Next to each PNG a `<name>.labels.json` lists the place names in view (pixel positions), for
 * captioning the review shots.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './world/png.js';
import { forestNoise, planWorld } from './world/plan.js';
import { renderMap } from './world/render.js';
import { planStats } from './world/stats.js';

const seed = Number(process.argv[2] ?? 1993);
const size = Number(process.argv[3] ?? 16384);
const out = process.argv[4] ?? '/workspace/deadzone-shots';
const prefix = process.argv[5] ?? 's2-worldmap';
mkdirSync(out, { recursive: true });

const t0 = performance.now();
const plan = planWorld({ seed, size });
const t1 = performance.now();
const stats = planStats(plan);
console.log(`plan ${(t1 - t0).toFixed(0)} ms`, JSON.stringify(stats, null, 1));

const save = (
  name: string,
  x0: number,
  y0: number,
  mpp: number,
  w: number,
  h: number,
  chunkGrid = false,
) => {
  const img = renderMap(plan, { x0, y0, mpp, w, h, chunkGrid });
  writeFileSync(join(out, `${prefix}-${name}.png`), encodePng(w, h, img));
  const inView = (x: number, y: number) =>
    x >= x0 && y >= y0 && x < x0 + w * mpp && y < y0 + h * mpp;
  const px = (x: number, y: number) => ({
    px: Math.round((x - x0) / mpp),
    py: Math.round((y - y0) / mpp),
  });
  const labels = [
    ...plan.settlements.map((s) => ({ text: s.name, kind: s.kind, x: s.x, y: s.y })),
    ...plan.areas
      .filter((a) => a.kind === 'lake' && a.name)
      .map((a) => ({ text: a.name ?? '', kind: 'lake', x: a.x, y: a.y })),
    ...plan.complexes
      .filter((c) => c.name && (c.kind === 'military' || c.kind === 'resort' || c.kind === 'farm'))
      .map((c) => ({ text: c.name ?? '', kind: c.kind, x: c.x, y: c.y })),
  ]
    .filter((l) => inView(l.x, l.y))
    .map(({ text, kind, x, y }) => ({ text, kind, ...px(x, y) }));
  writeFileSync(join(out, `${prefix}-${name}.labels.json`), JSON.stringify(labels));
  console.log('saved', `${prefix}-${name}.png`);
};
save('overview', 0, 0, size / 2048, 2048, 2048);
const city = plan.settlements.find((s) => s.kind === 'city');
if (city) save('city', city.x - 1024, city.y - 1024, 1, 2048, 2048);
if (city) save('city-centre', city.x - 300, city.y - 300, 0.5, 1200, 1200, true);
const town = plan.settlements.find((s) => s.kind === 'town');
if (town) save('town', town.x - 768, town.y - 768, 0.75, 2048, 2048);
// Countryside: the village with the most farms nearby.
const villages = plan.settlements.filter((s) => s.kind === 'village');
let best = villages[0];
let bestN = -1;
for (const v of villages) {
  const n = plan.buildings.filter(
    (b) => b.kind === 'farmhouse' && Math.hypot(b.x - v.x, b.y - v.y) < 1500,
  ).length;
  if (n > bestN) {
    bestN = n;
    best = v;
  }
}
if (best) save('country', best.x - 1536, best.y - 1536, 1.5, 2048, 2048);
// Old towns (irregular cores inside the grid): every city, the first two towns.
const cores = [
  ...plan.settlements.filter((s) => s.kind === 'city'),
  ...plan.settlements.filter((s) => s.kind === 'town').slice(0, 2),
];
const counter = { city: 0, town: 0, village: 0 };
for (const s of cores) {
  counter[s.kind]++;
  const name = `oldtown-${s.kind}${counter[s.kind] > 1 ? counter[s.kind] : ''}`;
  const half = s.kind === 'city' ? 330 : 220;
  save(name, s.x - half, s.y - half, (2 * half) / 1200, 1200, 1200, true);
}
// v3 review views: city → suburbs → allotments → fields, the river with its bridges in the
// main city, a village by a lake, and a frontage close-up in the old town.
const main = plan.settlements[0];
if (main) {
  // The direction with the least forest (and still on the map) from the edge of the city out,
  // where the allotments are: the whole gradient city → suburbs → allotments → fields.
  const allot = plan.areas.filter(
    (a) => a.kind === 'allotment' && Math.hypot(a.x - main.x, a.y - main.y) < main.r * 1.8,
  );
  let ang = 0;
  let best = Infinity;
  for (let k = 0; k < 24; k++) {
    const t = (k / 24) * Math.PI * 2;
    let cost = 0;
    for (let q = 0; q <= 12; q++) {
      const rr = main.r * (1 + (1.2 * q) / 12);
      const x = main.x + Math.cos(t) * rr;
      const y = main.y + Math.sin(t) * rr;
      if (x < 0 || y < 0 || x > plan.size || y > plan.size) cost += 2;
      else if (forestNoise(plan.seed, x, y, plan.size) > plan.forestThreshold) cost += 1;
    }
    for (const a of allot) {
      const d = Math.abs(
        Math.atan2(
          Math.sin(Math.atan2(a.y - main.y, a.x - main.x) - t),
          Math.cos(Math.atan2(a.y - main.y, a.x - main.x) - t),
        ),
      );
      if (d < 0.4) cost -= 0.5;
    }
    if (cost < best) {
      best = cost;
      ang = t;
    }
  }
  const cx = main.x + Math.cos(ang) * main.r * 1.2;
  const cy = main.y + Math.sin(ang) * main.r * 1.2;
  save('v3-suburbs', cx - 1200, cy - 1200, 2400 / 1600, 1600, 1600);
  const inCity = plan.bridges.filter((b) => Math.hypot(b.x - main.x, b.y - main.y) < main.r * 1.2);
  if (inCity.length) {
    const bx = inCity.reduce((s, b) => s + b.x, 0) / inCity.length;
    const by = inCity.reduce((s, b) => s + b.y, 0) / inCity.length;
    save('v3-river', bx - 700, by - 700, 1400 / 1600, 1600, 1600);
  }
  // The whole old town: frontages along the ring, the radials and round the square.
  save('v3-pierzeje', main.x - 290, main.y - 290, 580 / 1200, 1200, 1200);
}
{
  const lakes = plan.areas.filter((a) => a.kind === 'lake' && a.w > 150);
  let pick:
    { v: (typeof plan.settlements)[number]; l: (typeof lakes)[number]; d: number } | undefined;
  for (const v of plan.settlements.filter((s) => s.kind === 'village'))
    for (const l of lakes) {
      const d = Math.hypot(v.x - l.x, v.y - l.y) - l.w / 2;
      if (!pick || d < pick.d) pick = { v, l, d };
    }
  if (pick) {
    const mx = (pick.v.x + pick.l.x) / 2;
    const my = (pick.v.y + pick.l.y) / 2;
    const half = Math.max(
      800,
      (Math.hypot(pick.v.x - pick.l.x, pick.v.y - pick.l.y) + pick.l.w) / 2 + 250,
    );
    save('v3-village', mx - half, my - half, (2 * half) / 1600, 1600, 1600);
  }
}
save('v3-overview', 0, 0, size / 2048, 2048, 2048);
// Borowiec and the fields, copses, avenues and farms around it.
{
  const b = plan.settlements.find((s) => s.name === 'Borowiec');
  if (b) save('v3-borowiec', b.x - 2000, b.y - 2000, 4000 / 1600, 1600, 1600);
}
const mil = plan.complexes.find((c) => c.kind === 'military');
if (mil) save('military', mil.x - 768, mil.y - 768, 0.75, 2048, 2048);
writeFileSync(join(out, `${prefix}-stats.json`), JSON.stringify(stats, null, 2));
