import { LEVEL_HEIGHT } from '../world/instances.js';
import { CROWD_SAMPLE_STRIDE } from './crowd-buffer.js';

/**
 * Writes one column-major matrix per entity from sampled (x, y, z, facing) into `out`:
 * sim (x, y, z level) -> world (X = x, Y = z * LEVEL_HEIGHT, Z = y), rotation Y = -facing
 * (same mapping as sim/coords.ts). No allocations.
 */
export function writeCrowdMatrices(sampled: Float32Array, count: number, out: Float32Array): void {
  for (let i = 0; i < count; i++) {
    const s = i * CROWD_SAMPLE_STRIDE;
    const o = i * 16;
    const f = sampled[s + 3] ?? 0;
    const c = Math.cos(f);
    const n = Math.sin(f);
    out[o] = c;
    out[o + 1] = 0;
    out[o + 2] = n;
    out[o + 3] = 0;
    out[o + 4] = 0;
    out[o + 5] = 1;
    out[o + 6] = 0;
    out[o + 7] = 0;
    out[o + 8] = -n;
    out[o + 9] = 0;
    out[o + 10] = c;
    out[o + 11] = 0;
    out[o + 12] = sampled[s] ?? 0;
    out[o + 13] = (sampled[s + 2] ?? 0) * LEVEL_HEIGHT;
    out[o + 14] = sampled[s + 1] ?? 0;
    out[o + 15] = 1;
  }
}
