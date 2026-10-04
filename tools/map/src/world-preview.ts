/**
 * Dev: renders the world plan top-down to PNG for review (no game data is written).
 *   pnpm --filter @deadzone/map exec tsx src/world-preview.ts [seed] [size] [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './world/png.js';
import { planWorld } from './world/plan.js';
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
const mil = plan.complexes.find((c) => c.kind === 'military');
if (mil) save('military', mil.x - 768, mil.y - 768, 0.75, 2048, 2048);
writeFileSync(join(out, `${prefix}-stats.json`), JSON.stringify(stats, null, 2));
