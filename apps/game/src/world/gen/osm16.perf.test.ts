import { CENTRUM_SPOT } from './osm16-fixtures.js';
// Perf of the whole 16 km square (`osm-stw`, lazily loaded tiles): start load, tile indexing and
// chunk generation in four kinds of places. Thresholds are generous (≈10× the measured cost on
// the dev box) so they only catch pathological regressions; the numbers are logged.
import { CHUNK_SIZE } from '@deadzone/protocol';
import { expect, it } from 'vitest';
import { loadWorld } from './load-plan.js';
import { GENERATED_MAPS } from './maps.js';
import { publicFetch } from './osm16-fixtures.js';

/** World points of the screenshot set (`s2-osm16-*.png`). */
export const OSM16_SPOTS = {
  centrum: CENTRUM_SPOT,
  bloki: { x: 8640, y: 11072 },
  hala: { x: 8256, y: 12480 },
  wies: { x: 7463, y: 3919 },
} as const;

const pct = (a: number[], p: number) =>
  [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] ?? 0;

it('opens fast and generates chunks anywhere in the square', async () => {
  const files: string[] = [];
  let t = performance.now();
  const w = await loadWorld(GENERATED_MAPS['osm-stw']!, publicFetch(files));
  const startMs = performance.now() - t;
  const tiles = w.tiles!;
  const startTiles = tiles.loadedCount;
  const lines = [`start: ${startMs.toFixed(0)} ms, ${startTiles} tiles (${files.length} files)`];
  const all: number[] = [];
  for (const [name, p] of Object.entries(OSM16_SPOTS)) {
    const cx = Math.floor(p.x / CHUNK_SIZE);
    const cy = Math.floor(p.y / CHUNK_SIZE);
    t = performance.now();
    await tiles.ensure(cx, cy);
    const loadMs = performance.now() - t;
    const ms: number[] = [];
    let objects = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const t0 = performance.now();
        const c = w.gen.column(cx + dx, cy + dy);
        ms.push(performance.now() - t0);
        objects += c?.levels.reduce((a, l) => a + l.objects.length, 0) ?? 0;
      }
    all.push(...ms);
    lines.push(
      `${name}: tiles ${loadMs.toFixed(0)} ms, chunk p50 ${pct(ms, 0.5).toFixed(1)} / p95 ` +
        `${pct(ms, 0.95).toFixed(1)} / max ${Math.max(...ms).toFixed(1)} ms, ${objects} objects`,
    );
  }
  t = performance.now();
  await tiles.ensureAll();
  const allMs = performance.now() - t;
  lines.push(
    `all tiles: ${tiles.loadedCount} in ${allMs.toFixed(0)} ms (index ${tiles.stats.ms.toFixed(0)} ms total)`,
  );
  console.info(`[osm16-bench]\n  ${lines.join('\n  ')}`);
  expect(startTiles).toBeLessThanOrEqual(9);
  expect(startMs).toBeLessThan(15_000);
  expect(pct(all, 0.5)).toBeLessThan(400);
  expect(allMs).toBeLessThan(120_000);
}, 300_000);
