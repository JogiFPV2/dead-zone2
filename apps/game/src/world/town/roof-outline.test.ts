import { describe, expect, it } from 'vitest';
import type { TownCells } from './kit.js';
import { outlineRoof } from './roof.js';

const cells = { uv: () => [0, 0], color: () => undefined } as unknown as TownCells;
const sq = (c: number, h: number) => [c - h, c - h, c + h, c - h, c + h, c + h, c - h, c + h];

/** Whether a slab triangle (y ≈ y0) covers (x, z). */
function slabCovers(pos: Float32Array, idx: ArrayLike<number>, y: number, x: number, z: number) {
  for (let t = 0; t < idx.length; t += 3) {
    const v = [0, 1, 2].map((k) => idx[t + k]!);
    if (!v.every((i) => Math.abs(pos[3 * i + 1]! - y) < 1e-3)) continue;
    const [a, b, c] = v.map((i) => [pos[3 * i]!, pos[3 * i + 2]!] as const);
    const s = (p: readonly number[], q: readonly number[]) =>
      (q[0]! - p[0]!) * (z - p[1]!) - (q[1]! - p[1]!) * (x - p[0]!);
    const d = [s(a!, b!), s(b!, c!), s(c!, a!)];
    if (d.every((e) => e >= 0) || d.every((e) => e <= 0)) return true;
  }
  return false;
}

describe('outlineRoof', () => {
  it('leaves a courtyard (hole) open and covers the rest', () => {
    const g = outlineRoof(sq(0, 15), 'roof', 'wall', cells, 3, undefined, [sq(0, 5)])!;
    const pos = g.getAttribute('position').array as Float32Array;
    const idx = g.index!.array;
    expect(slabCovers(pos, idx, 3.02, 0, 0)).toBe(false);
    expect(slabCovers(pos, idx, 3.02, 10, 10)).toBe(true);
    const plain = outlineRoof(sq(0, 15), 'roof', 'wall', cells, 3)!;
    expect(
      slabCovers(
        plain.getAttribute('position').array as Float32Array,
        plain.index!.array,
        3.02,
        0,
        0,
      ),
    ).toBe(true);
  });
});
