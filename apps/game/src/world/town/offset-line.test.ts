import { describe, expect, it } from 'vitest';
import { offsetLine } from './terrain-mesh.js';

describe('offsetLine (lane lines, map stw2)', () => {
  it('shifts a straight line sideways', () => {
    expect(offsetLine([0, 0, 10, 0], 2)).toEqual([0, -2, 10, -2]);
  });
  it('keeps the offset at a right-angle bend (miter)', () => {
    const p = offsetLine([0, 0, 10, 0, 10, 10], 1);
    expect(p[2]).toBeCloseTo(11);
    expect(p[3]).toBeCloseTo(-1);
  });
});
