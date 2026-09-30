// Micro-benchmark of the per-frame crowd path for 1000 entities. The threshold is deliberately
// generous (≈50× the measured cost) so it only catches pathological regressions, never noise.
import { expect, it } from 'vitest';
import { createRng } from '@deadzone/sim';
import { SNAPSHOT_ENTITY_STRIDE } from '@deadzone/protocol';
import { CROWD_SAMPLE_STRIDE, CrowdBuffer } from './crowd-buffer.js';
import { writeCrowdMatrices } from './crowd-matrices.js';
import { createCrowd, stepCrowd, writeCrowd } from './mock-crowd.js';

const N = 1000;
const FRAMES = 500;
const bounds = { minX: -64, minY: -64, maxX: 64, maxY: 64 };

it(`samples and writes matrices for ${N} entities well under a frame budget`, () => {
  const rng = createRng(7);
  const crowd = createCrowd(N, rng, bounds);
  const snapshot = new Float32Array((N + 1) * SNAPSHOT_ENTITY_STRIDE);
  const buffer = new CrowdBuffer();
  const sampled = new Float32Array(N * 2 * CROWD_SAMPLE_STRIDE);
  const matrices = new Float32Array(N * 2 * 16);

  let pushMs = 0;
  let frameMs = 0;
  for (let f = 0; f < FRAMES; f++) {
    if (f % 3 === 0) {
      stepCrowd(crowd, rng, 0.05, bounds);
      writeCrowd(crowd, snapshot, SNAPSHOT_ENTITY_STRIDE);
      const t = performance.now();
      buffer.push(snapshot, 1);
      pushMs += performance.now() - t;
    }
    const t = performance.now();
    writeCrowdMatrices(sampled, buffer.sample((f % 3) / 3, sampled), matrices);
    frameMs += performance.now() - t;
  }
  const perFrame = frameMs / FRAMES;
  const perPush = pushMs / Math.ceil(FRAMES / 3);
  console.info(
    `[crowd-perf] ${N} entities: sample+matrices ${perFrame.toFixed(3)} ms/frame, ` +
      `push ${perPush.toFixed(3)} ms/snapshot`,
  );
  expect(buffer.count).toBe(N);
  expect(perFrame).toBeLessThan(4);
  expect(perPush).toBeLessThan(8);
});
