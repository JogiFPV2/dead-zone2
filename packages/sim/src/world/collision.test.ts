import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS } from '../core/constants.js';
import { Rng } from '../core/rng.js';
import { createSim } from '../sim.js';
import { buildMap } from '../test/fixtures.js';
import { move, run } from '../test/helpers.js';
import { SKIN, circleOverlaps, moveCircle } from './collision.js';
import { TileGrid } from './grid.js';

const R = PLAYER_RADIUS;

describe('collisions with wall edges', () => {
  // West edge of column 12 = wall along x = 12 for all rows.
  const map = buildMap({ wallW: (x) => x === 12 });

  it('stops at a west-edge wall (moving +x)', () => {
    const sim = createSim({ seed: 1, map, spawn: { x: 10.5, y: 5.5 } });
    move(sim, 1, 0);
    run(sim, 40);
    const x = sim.getPlayer()!.x;
    expect(x).toBeLessThanOrEqual(12 - R);
    expect(x).toBeCloseTo(12 - R - SKIN, 3);
  });

  it('blocks from the other side too (moving -x)', () => {
    const sim = createSim({ seed: 1, map, spawn: { x: 14.5, y: 5.5 } });
    move(sim, -1, 0);
    run(sim, 40);
    expect(sim.getPlayer()!.x).toBeGreaterThanOrEqual(12 + R);
  });

  it('stops at a north-edge wall (moving -y)', () => {
    const m = buildMap({ wallN: (_x, y) => y === 8 });
    const sim = createSim({ seed: 1, map: m, spawn: { x: 5.5, y: 10.5 } });
    move(sim, 0, -1);
    run(sim, 40);
    expect(sim.getPlayer()!.y).toBeGreaterThanOrEqual(8 + R);
    expect(sim.getPlayer()!.y).toBeCloseTo(8 + R + SKIN, 3);
  });

  it('slides along a wall made of many segments without snagging', () => {
    const sim = createSim({ seed: 1, map, spawn: { x: 11.5, y: 2.5 } });
    move(sim, 1, 1);
    run(sim, 60);
    const y = sim.getPlayer()!.y;
    run(sim, 40);
    const p = sim.getPlayer()!;
    expect(p.x).toBeLessThanOrEqual(12 - R);
    // Only the y component (1/√2 of 1.5 tiles/s) remains after hitting the wall, at full rate.
    expect(p.y - y).toBeCloseTo(2 * 1.5 * Math.SQRT1_2, 4);
    // − the jerk-limited start (2.5 ticks).
    expect(p.y).toBeCloseTo(2.5 + (5 - 0.125) * 1.5 * Math.SQRT1_2, 1);
  });

  it('does not tunnel through a thin wall at very high speed', () => {
    const sim = createSim({
      seed: 1,
      map,
      spawn: { x: 10.5, y: 5.5 },
      walkSpeedTilesPerSecond: 20 * 40, // 40 tiles per tick
    });
    move(sim, 1, 0);
    run(sim, 3);
    expect(sim.getPlayer()!.x).toBeLessThanOrEqual(12 - R);
    const grid = new TileGrid(map);
    expect(moveCircle(grid, 0, 11.5, 5.5, 1000, 0, R).x).toBeLessThanOrEqual(12 - R);
    expect(moveCircle(grid, 0, 13.5, 5.5, -1000, 0, R).x).toBeGreaterThanOrEqual(12 + R);
  });
});

describe('collisions with tiles', () => {
  it('treats tiles without floor as solid', () => {
    const map = buildMap({ floor: (x, y) => (x === 15 && y === 5 ? 0 : 1) });
    const sim = createSim({ seed: 1, map, spawn: { x: 12.5, y: 5.5 } });
    move(sim, 1, 0);
    run(sim, 40);
    expect(sim.getPlayer()!.x).toBeCloseTo(15 - R - SKIN, 3);
  });

  it('treats the outside of the map as solid', () => {
    const sim = createSim({ seed: 1, map: buildMap(), spawn: { x: 1.5, y: 1.5 } });
    move(sim, -1, -1);
    run(sim, 40);
    const p = sim.getPlayer()!;
    expect(p.x).toBeCloseTo(R + SKIN, 3);
    expect(p.y).toBeCloseTo(R + SKIN, 3);
  });

  it('stops in an inner corner (two walls)', () => {
    const map = buildMap({ wallW: (x) => x === 20, wallN: (_x, y) => y === 20 });
    const sim = createSim({ seed: 1, map, spawn: { x: 22.5, y: 22.5 } });
    move(sim, -1, -1);
    run(sim, 60);
    const p = sim.getPlayer()!;
    expect(p.x).toBeCloseTo(20 + R + SKIN, 3);
    expect(p.y).toBeCloseTo(20 + R + SKIN, 3);
  });

  it('respects the rounded outer corner of a solid tile', () => {
    const map = buildMap({ floor: (x, y) => (x === 10 && y === 10 ? 0 : 1) });
    const grid = new TileGrid(map);
    // Diagonal move past the corner (11, 11): x resolves first (free), then y hits the tile.
    const p = moveCircle(grid, 0, 12, 12, -2, -2, R);
    expect(p.x).toBe(10);
    expect(p.y).toBeCloseTo(11 + R + SKIN, 5);
    expect(circleOverlaps(grid, 0, p.x, p.y, R)).toBe(false);
    // Moving straight at the corner point from a diagonal offset stops on the rounded corner.
    const c = moveCircle(grid, 0, 11.2, 12, 0, -2, R);
    expect(Math.sqrt((c.x - 11) ** 2 + (c.y - 11) ** 2)).toBeCloseTo(R + SKIN, 3);
    // Passing next to the corner along x (0.1 below the tile's bottom edge + R) is not blocked.
    const q = moveCircle(grid, 0, 13, 11 + R + 0.1, -5, 0, R);
    expect(q.x).toBeCloseTo(8, 5);
  });

  it('never ends inside an obstacle (random walk on a maze)', () => {
    const maze = new Rng([1, 2, 3, 4]);
    const walls = new Set<number>();
    for (let i = 0; i < 64 * 64; i++) if (maze.chance(0.15)) walls.add(i);
    const map = buildMap({
      floor: (x, y) => (maze.chance(0.03) && (x + y) % 7 !== 0 ? 0 : 1),
      wallN: (x, y) => walls.has(y * 64 + x) && x % 2 === 0,
      wallW: (x, y) => walls.has(y * 64 + x) && x % 2 === 1,
    });
    const grid = new TileGrid(map);
    const rng = new Rng([9, 8, 7, 6]);
    let x = 32.5;
    let y = 32.5;
    while (circleOverlaps(grid, 0, x, y, R)) x += 1;
    for (let i = 0; i < 5000; i++) {
      const speed = rng.chance(0.1) ? 5 : 0.15;
      const p = moveCircle(
        grid,
        0,
        x,
        y,
        (rng.nextFloat() * 2 - 1) * speed,
        (rng.nextFloat() * 2 - 1) * speed,
        R,
      );
      x = p.x;
      y = p.y;
      expect(circleOverlaps(grid, 0, x, y, R)).toBe(false);
    }
  });
});
