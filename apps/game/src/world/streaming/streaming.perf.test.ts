// Micro-benchmark of chunk generation + LOD builds (stress world). Thresholds are generous
// (≈20× the measured cost) so they only catch pathological regressions; the numbers are logged.
import { expect, it } from 'vitest';
import { LOD_FAR, LOD_MID, LOD_NEAR, STREAM_PRESETS } from './rings.js';
import { createWorldStreaming } from './setup.js';
import { STRESS_WORLD_CHUNKS, StressWorldSource } from './stress-source.js';
import type { WorldChunk } from './source.js';

it('builds stress-world chunks well inside the per-frame budget', async () => {
  const src = new StressWorldSource(1);
  const n = 40;
  const mid = STRESS_WORLD_CHUNKS / 2;
  let t = performance.now();
  const chunks: WorldChunk[] = [];
  for (let i = 0; i < n; i++) chunks.push(src.generate(mid + (i % 8), mid + Math.floor(i / 8))!);
  const genMs = (performance.now() - t) / n;
  const w = createWorldStreaming(src, STREAM_PRESETS.medium);
  const time = (lod: 0 | 1 | 2) => {
    t = performance.now();
    for (const c of chunks) {
      w.streamer.loaded.set(c);
      w.lod.build(c.cx, c.cy, lod, c, undefined).dispose();
    }
    return (performance.now() - t) / n;
  };
  const nearMs = time(LOD_NEAR);
  const midMs = time(LOD_MID);
  const farMs = time(LOD_FAR);
  console.info(
    `[stream-bench] per chunk: generate ${genMs.toFixed(2)} ms · near ${nearMs.toFixed(2)} ms · ` +
      `mid ${midMs.toFixed(2)} ms · far ${farMs.toFixed(2)} ms`,
  );
  expect(genMs).toBeLessThan(40);
  expect(nearMs).toBeLessThan(60);
  expect(midMs).toBeLessThan(60);
  expect(farMs).toBeLessThan(20);
  await Promise.resolve();
});
