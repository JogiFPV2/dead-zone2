import { describe, expect, it } from 'vitest';
import { genLampsOf } from './gen-lamps.js';

describe('genLampsOf', () => {
  it('maps generator lamps of loaded chunks in range to LampDefs', () => {
    const lamps = genLampsOf(
      {
        column: (cx, cy) =>
          cx === 0 && cy === 0
            ? { cx, cy, levels: new Map(), lamps: [{ x: 3, y: 4, ax: 0, ay: -1 }] }
            : undefined,
      },
      { cx0: 0, cy0: 0, cx1: 1, cy1: 1, z: 0 },
    );
    expect(lamps).toHaveLength(1);
    expect(lamps[0]).toMatchObject({ x: 3, z: 4, armX: 0, armZ: -1 });
  });
});
