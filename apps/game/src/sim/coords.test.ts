import { describe, expect, it } from 'vitest';
import { facingToRotationY, simToWorld, worldToSimFloor } from './coords.js';

describe('sim <-> world coords', () => {
  it('maps sim y to three Z and level z to height', () => {
    expect(simToWorld(1.5, -2.5, 0)).toEqual({ x: 1.5, y: 0, z: -2.5 });
    expect(simToWorld(0, 0, 2)).toEqual({ x: 0, y: 6, z: 0 });
    expect(worldToSimFloor(3, -4)).toEqual({ x: 3, y: -4 });
  });

  it('turns local +X to the facing direction on the floor', () => {
    for (const facing of [0, Math.PI / 2, -Math.PI / 2, 2]) {
      const r = facingToRotationY(facing);
      // three.js Y rotation of (1,0,0): (cos r, 0, -sin r)
      expect(Math.cos(r)).toBeCloseTo(Math.cos(facing));
      expect(-Math.sin(r)).toBeCloseTo(Math.sin(facing));
    }
  });
});
