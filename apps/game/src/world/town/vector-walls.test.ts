import { describe, expect, it } from 'vitest';
import type { InstancedMesh } from 'three';
import { Color, Matrix4, Vector3 } from 'three';
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

describe('facade bands (plinth, cornice, storey band, lintel)', () => {
  it('ground floor: plinth + cornice on a one-storey house, storey band below the top', async () => {
    const { wallBands, PLINTH, CORNICE, STOREY_BAND } = await import('./vector-walls.js');
    const { LEVEL_HEIGHT } = await import('../instances.js');
    expect(wallBands(0, WALL_HEIGHT)).toEqual([PLINTH, CORNICE]);
    expect(wallBands(0, LEVEL_HEIGHT)).toEqual([PLINTH, STOREY_BAND]);
    expect(wallBands(1, WALL_HEIGHT)).toEqual([CORNICE]);
    // Thicker than the corner posts, so they never poke through.
    const { POST_SIZE } = await import('./vector-walls.js');
    for (const b of [PLINTH, CORNICE, STOREY_BAND])
      expect(b.t).toBeGreaterThan(POST_SIZE * Math.SQRT2);
  });

  it('cut with the wall: the plinth shrinks, the cornice goes with the full height', async () => {
    const { bandAt, PLINTH, CORNICE } = await import('./vector-walls.js');
    const s = { x0: 0, y0: 0, x1: 4, y1: 0, z: 0 };
    const top = (m: Matrix4) => new Vector3(0, 1, 0).applyMatrix4(m).y;
    const m = new Matrix4();
    expect(top(bandAt(m, s, 0, PLINTH, WALL_HEIGHT, WALL_HEIGHT))).toBeCloseTo(PLINTH.h, 5);
    expect(top(bandAt(m, s, 0, PLINTH, LOWERED_HEIGHT, WALL_HEIGHT))).toBeCloseTo(
      LOWERED_HEIGHT,
      5,
    );
    expect(top(bandAt(m, s, 0, CORNICE, WALL_HEIGHT, WALL_HEIGHT))).toBeCloseTo(WALL_HEIGHT, 5);
    // Lowered or hidden: no cornice floating over the cut wall.
    expect(bandAt(m, s, 0, CORNICE, LOWERED_HEIGHT, WALL_HEIGHT).determinant()).toBe(0);
    expect(bandAt(m, s, 0, PLINTH, 0, WALL_HEIGHT).determinant()).toBe(0);
  });

  it('a gap gets the bands and, below the top storey, a lintel up to the next slab', async () => {
    const { VectorWalls } = await import('./vector-walls.js');
    const { LEVEL_HEIGHT } = await import('../instances.js');
    const { MeshStandardMaterial } = await import('three');
    const cells = { uv: () => [0, 0] as [number, number], color: () => new Color() };
    const seg = { x0: 0, y0: 0, x1: 4, y1: 0, z: 0, building: 3 };
    const gap = { x0: 4, y0: 0, x1: 5.2, y1: 0, z: 0, building: 3 };
    const count = (full: number, door: boolean) => {
      const w = new VectorWalls(
        [seg],
        0,
        0,
        cells,
        new MeshStandardMaterial(),
        () => 'plaster',
        () => full,
        undefined,
        [{ seg: gap, door }],
      );
      return w.root.children[0] ? (w.root.children[0] as InstancedMesh).count : 0;
    };
    // wall + 2 posts + plinth + cornice; window gap: plinth + cornice.
    expect(count(WALL_HEIGHT, false)).toBe(5 + 2);
    // Door gap: no plinth.
    expect(count(WALL_HEIGHT, true)).toBe(5 + 1);
    // Lower storey: storey band instead of the cornice, and a lintel over the gap.
    expect(count(LEVEL_HEIGHT, false)).toBe(5 + 3);
  });
});
