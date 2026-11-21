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

describe('openingOnOutline', () => {
  it('puts a window of a 5° wall into the wall gap, turned along it, inside kept', async () => {
    const { openingOnOutline } = await import('./vector-walls.js');
    const a = (5 * Math.PI) / 180;
    // Wall from (0, 0) along 5°, the room south of it (+y): N tile edge (3, 0)–(4, 0).
    const ring = [0, 0, 10 * Math.cos(a), 10 * Math.sin(a), 10 * Math.cos(a), 10, 0, 10];
    const p = openingOnOutline([ring], 3, 0, 4, 0, 0)!;
    expect(p).toBeDefined();
    // On the wall line, about under the tile edge's middle, turned by −5° about +y.
    expect(Math.abs(p.z - p.x * Math.tan(a))).toBeLessThan(1e-6);
    expect(Math.abs(p.x - 3.5)).toBeLessThan(0.1);
    expect(p.rotY).toBeCloseTo(-a, 6);
    expect(p.width).toBeGreaterThan(1);
    expect(p.width).toBeLessThan(1.4);
    // No wall within reach: no placement.
    expect(openingOnOutline([ring], 3, 5, 4, 5, 0)).toBeUndefined();
  });
});
