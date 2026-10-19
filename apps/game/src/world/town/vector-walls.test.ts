import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { NO_CUTAWAY } from '../cutaway.js';
import { LOWERED_HEIGHT, WALL_HEIGHT } from '../structure-instances.js';
import { segmentMatrix, vectorWallHeight } from './vector-walls.js';

describe('vector walls', () => {
  it('stretches a unit box along a slanted segment (sim y → world Z)', () => {
    const m = segmentMatrix(
      new Matrix4(),
      { x0: 10, y0: 20, x1: 13, y1: 24, z: 0 },
      0,
      WALL_HEIGHT,
    );
    const a = new Vector3(-0.5, 0, 0).applyMatrix4(m);
    const b = new Vector3(0.5, 1, 0).applyMatrix4(m);
    const dir = new Vector3(3, 0, 4).normalize();
    // ends extended by half the thickness along the segment
    expect(a.x).toBeCloseTo(10 - dir.x * 0.075, 5);
    expect(a.z).toBeCloseTo(20 - dir.z * 0.075, 5);
    expect(b.x).toBeCloseTo(13 + dir.x * 0.075, 5);
    expect(b.z).toBeCloseTo(24 + dir.z * 0.075, 5);
    expect(b.y).toBeCloseTo(WALL_HEIGHT, 5);
  });

  it('lowers the walls of the building the player is in and hides upper levels', () => {
    expect(vectorWallHeight(NO_CUTAWAY, 7, 0, 5, 5)).toBe(WALL_HEIGHT);
    const inside = { ...NO_CUTAWAY, building: 7, tx: 5, ty: 5 };
    expect(vectorWallHeight(inside, 7, 0, 5, 5)).toBe(LOWERED_HEIGHT);
    expect(vectorWallHeight(inside, 7, 1, 5, 5)).toBe(0);
  });
});
