import { CHUNK_SIZE } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { buildMap } from '../test/fixtures.js';
import { furnitureOverlay } from './furniture-overlay.js';
import { createPhysicsWorld } from './step.js';
import { createRngStreams } from '../core/rng.js';

/** Host clock (perf tests only; the sim never reads time). */
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as { performance: { now(): number } };

/** Timing of the furniture overlay (docs 9.61): untouched chunks cost a size check only. */
describe('furniture overlay perf', () => {
  it('100 moved pieces: 200k getChunk calls stay cheap (cached patched chunks)', () => {
    const objects = Array.from({ length: 100 }, (_, i) => ({
      contentId: 'x',
      x: (i % 10) * 3,
      y: Math.floor(i / 10) * 3,
    }));
    const base = buildMap({ width: 256, height: 256, objects });
    const pw = createPhysicsWorld(createRngStreams(1).physics);
    const map = furnitureOverlay(base, pw);
    for (let i = 0; i < 100; i++)
      pw.furnitureMoves.set(`0,0,0,${i}`, {
        contentId: 'x',
        x: ((i % 10) * 3 + 1 + CHUNK_SIZE * (i % 3)) % 256,
        y: Math.floor(i / 10) * 3,
        z: 0,
        rot: 0,
      });
    pw.furnitureRev++;
    const t0 = host.performance.now();
    let n = 0;
    for (let k = 0; k < 200_000; k++)
      n += map.getChunk(k % 8, (k >> 3) % 8, 0)?.objects?.length ?? 0;
    const ms = host.performance.now() - t0;
    expect(n).toBeGreaterThan(0);
    expect(ms).toBeLessThan(400);
  });
});
