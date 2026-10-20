import { describe, expect, it } from 'vitest';
import { CLEARING_WIDTH, clearingMask } from './clearing.js';
import type { IPower } from './plan-index.js';

const line = (kind: IPower['kind']): IPower => ({
  id: 1,
  kind,
  circuits: 1,
  pts: new Float64Array([0, 32, 64, 32]),
});

describe('clearingMask (przecinki pod liniami WN)', () => {
  it('strip width follows the voltage, low voltage gets none', () => {
    for (const kind of ['hv110', 'hv220', 'hv400'] as const) {
      const m = clearingMask([line(kind)], 0, 0, 64)!;
      let rows = 0;
      for (let y = 0; y < 64; y++) if (m[y * 64 + 10]) rows++;
      expect(rows).toBe(CLEARING_WIDTH[kind]);
    }
    expect(clearingMask([line('lv')], 0, 0, 64)).toBeUndefined();
    expect(CLEARING_WIDTH).toEqual({ hv110: 30, hv220: 40, hv400: 60 });
  });
  it('is chunk-local and misses far chunks', () => {
    const m = clearingMask([line('hv110')], 0, 40, 64)!;
    expect(m[0 * 64 + 5]).toBe(1); // y=40 is 8 m from the axis
    expect(m[10 * 64 + 5]).toBe(0); // y=50: 18 m
    expect(clearingMask([line('hv400')], 0, 200, 64)).toBeUndefined();
  });
});
