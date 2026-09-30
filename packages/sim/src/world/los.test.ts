import { describe, expect, it } from 'vitest';
import { buildMap } from '../test/fixtures.js';
import { TileGrid } from './grid.js';
import { edgesBetween, lineOfSight, walkableLine } from './los.js';
import { simMapFromData, simMapToData } from '@deadzone/protocol';

describe('world/los', () => {
  // Wall on x = 10 for y in [0, 20); a window (edge id 2) at y = 5.
  const base = buildMap({ wallW: (x, y) => x === 10 && y < 20 });
  const data = simMapToData(base, { cx0: 0, cy0: 0, cx1: 1, cy1: 1, z: 0 });
  for (const c of data.chunks) if (c.cx === 0 && c.cy === 0) c.edgeW[5 * 32 + 10] = 2;
  const map = simMapFromData({ ...data, edgeKinds: [null, 'wall', 'window'] });
  const grid = new TileGrid(map);

  it('walls block sight, windows let it through, both count for sound', () => {
    expect(lineOfSight(grid, 0, 5.5, 3.5, 15.5, 3.5)).toBe(false);
    expect(lineOfSight(grid, 0, 5.5, 5.5, 15.5, 5.5)).toBe(true);
    expect(lineOfSight(grid, 0, 5.5, 25.5, 15.5, 25.5)).toBe(true);
    expect(edgesBetween(grid, 0, 5.5, 5.5, 15.5, 5.5, 4)).toBe(1);
    expect(edgesBetween(grid, 0, 5.5, 3.5, 15.5, 3.5, 4)).toBe(1);
    expect(edgesBetween(grid, 0, 5.5, 25.5, 15.5, 25.5, 4)).toBe(0);
  });

  it('walking needs no edge at all (a window blocks movement)', () => {
    expect(walkableLine(grid, 0, 5.5, 5.5, 15.5, 5.5)).toBe(false);
    expect(walkableLine(grid, 0, 5.5, 25.5, 15.5, 25.5)).toBe(true);
    expect(walkableLine(grid, 0, 5.5, 25.5, 15.5, 10.5)).toBe(false);
  });

  it('without an edge palette every edge is a wall', () => {
    const g = new TileGrid(simMapFromData(data));
    expect(lineOfSight(g, 0, 5.5, 5.5, 15.5, 5.5)).toBe(false);
  });

  it('a ray exactly through a corner passes when one route around it is open', () => {
    const ray = (g: TileGrid) => lineOfSight(g, 0, 4.5, 4.5, 5.5, 5.5);
    // One wall segment next to the corner (x = 5, y ∈ [4, 5]): open below it.
    expect(ray(new TileGrid(buildMap({ wallW: (x, y) => x === 5 && y === 4 })))).toBe(true);
    // An L closing the corner from the start tile.
    const l = buildMap({
      wallW: (x, y) => x === 5 && y === 4,
      wallN: (x, y) => x === 4 && y === 5,
    });
    expect(ray(new TileGrid(l))).toBe(false);
    // A straight wall through the corner.
    const wall = buildMap({ wallW: (x, y) => x === 5 && (y === 4 || y === 5) });
    expect(ray(new TileGrid(wall))).toBe(false);
  });
});
