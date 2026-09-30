import { describe, expect, it } from 'vitest';
import { buildMap } from '../test/fixtures.js';
import { TileGrid } from '../world/grid.js';
import { findPath } from './astar.js';
import { canStep } from './grid-nav.js';
import { buildFlowField, flowStep } from './flow.js';

// A wall x = 10 from y = 0 to 29 (gap at y ≥ 30).
const grid = new TileGrid(buildMap({ wallW: (x, y) => x === 10 && y < 30 }));

describe('nav', () => {
  it('no corner cutting: a diagonal needs both orthogonal routes', () => {
    expect(canStep(grid, 0, 9, 5, 1, 0)).toBe(false);
    expect(canStep(grid, 0, 9, 5, 1, 1)).toBe(false);
    expect(canStep(grid, 0, 9, 29, 1, 1)).toBe(false);
    expect(canStep(grid, 0, 9, 30, 1, 1)).toBe(true);
    expect(canStep(grid, 0, 9, 30, 0, -1)).toBe(true);
  });

  it('A* walks around the wall, deterministic, within the node limit', () => {
    const a = findPath(grid, 0, 5, 5, 15, 5, 5000);
    const b = findPath(grid, 0, 5, 5, 15, 5, 5000);
    expect(a.tiles).toBeDefined();
    expect([...a.tiles!]).toEqual([...b.tiles!]);
    const ys = [];
    for (let i = 1; i < a.tiles!.length; i += 2) ys.push(a.tiles![i]!);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(30);
    const last = a.tiles!.length;
    expect([a.tiles![last - 2], a.tiles![last - 1]]).toEqual([15, 5]);
    // Each step is a legal move.
    let px = 5;
    let py = 5;
    for (let i = 0; i < last; i += 2) {
      const nx = a.tiles![i]!;
      const ny = a.tiles![i + 1]!;
      expect(canStep(grid, 0, px, py, nx - px, ny - py)).toBe(true);
      px = nx;
      py = ny;
    }
    expect(findPath(grid, 0, 5, 5, 15, 5, 50).tiles).toBeUndefined();
  });

  it('no path into a closed room', () => {
    const closed = new TileGrid(
      buildMap({
        wallW: (x, y) => (x === 20 || x === 25) && y >= 20 && y < 25,
        wallN: (x, y) => (y === 20 || y === 25) && x >= 20 && x < 25,
      }),
    );
    expect(findPath(closed, 0, 5, 5, 22, 22, 20000).tiles).toBeUndefined();
  });

  it('flow field leads to the target around the wall', () => {
    const f = buildFlowField(undefined, grid, 0, 15, 5, 64, 0);
    let x = 5;
    let y = 5;
    for (let i = 0; i < 100 && !(x === 15 && y === 5); i++) {
      const s = flowStep(f, grid, x, y)!;
      expect(canStep(grid, 0, x, y, s.x - x, s.y - y)).toBe(true);
      x = s.x;
      y = s.y;
    }
    expect([x, y]).toEqual([15, 5]);
    expect(flowStep(f, grid, 15, 5)).toBeUndefined();
    expect(flowStep(f, grid, 100, 100)).toBeUndefined();
  });
});
