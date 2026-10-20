import { describe, expect, it } from 'vitest';
import { autoAimTarget } from './auto-aim.js';

describe('auto aim (touch, no aim drag)', () => {
  const z = (id: number, x: number, zz: number) => ({ id, x, z: zz });
  it('nearest zombie in the cone in front, in range', () => {
    const list = [z(1, 2, 0), z(2, 1.5, 0.3), z(3, -1, 0), z(4, 4, 0), z(5, 0, 1)];
    expect(autoAimTarget(0, 0, 0, list)?.id).toBe(2);
    // Facing +y (atan2 = π/2): only the one south.
    expect(autoAimTarget(0, 0, Math.PI / 2, list)?.id).toBe(5);
    expect(autoAimTarget(0, 0, Math.PI, [z(1, 2, 0)])).toBeUndefined();
    expect(autoAimTarget(0, 0, 0, [])).toBeUndefined();
  });
});
