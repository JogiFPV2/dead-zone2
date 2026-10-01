import { describe, expect, it } from 'vitest';
import { createSim } from '../sim.js';
import { NOON } from '../test/ai-fixtures.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { buildLevels } from '../test/level-fixtures.js';
import { TileGrid } from '../world/grid.js';
import { DEFAULT_PHYSICS_CONFIG } from './constants.js';
import { physicsLevelMove } from './stairs.js';

/** Flight (20..23, 20) climbing E in a walled corridor, entrance on x = 20 (as in stairs.test). */
const inA = (x: number, y: number) => y === 20 && x >= 20 && x < 24;
const map = () =>
  buildLevels(
    [
      { z: 0, wallN: (x, y) => (y === 20 || y === 21) && x >= 20 && x < 24 },
      { z: 1, floor: (x, y) => !inA(x, y) },
    ],
    [{ x: 20, y: 20, z: 0, dir: 'E', len: 4 }],
  );

/**
 * Two zombies just below the entrance step onto the flight in the same tick, the one moving
 * second slightly ahead. The moves go straight through the movement hook (no AI, no
 * `walkableLine`), in the movement system's order.
 */
function enterTogether(order: 'low-first' | 'high-first') {
  const m = map();
  const sim = createSim({
    seed: 7,
    map: m,
    spawn: { x: 5.5, y: 5.5 },
    content: fixtureContent(),
    dev: true,
    clockStart: NOON,
    spawnZombies: [
      { x: 10.5, y: 10.5 },
      { x: 12.5, y: 12.5 },
    ],
  });
  sim.step();
  const w = sim.world;
  const grid = new TileGrid(m);
  const { Position, Zombie } = w.c;
  const eids = [...w.physics.bodies.values()]
    .filter((b) => b.kind === 'zombie')
    .map((b) =>
      [...Array(Position.x.length).keys()].find(
        (e) => Zombie.is[e] === 1 && w.c.StableId.value[e] === b.id,
      )!,
    );
  const moving = order === 'low-first' ? eids : [...eids].reverse();
  const start = [19.69, 19.695]; // along −0.31 and −0.305 (radius 0.3): both off the flight
  const across = [20.45, 20.55];
  moving.forEach((eid, i) => {
    const b = [...w.physics.bodies.values()].find((o) => o.id === w.c.StableId.value[eid])!;
    Position.x[eid] = b.x = start[i]!;
    Position.y[eid] = b.y = across[i]!;
    Position.z[eid] = 0;
    b.stair = 0;
  });
  const out = { x: 0, y: 0 };
  for (const eid of moving) {
    physicsLevelMove(w, grid, eid, 0.1, 0, out);
    Position.x[eid] = out.x;
    Position.y[eid] = out.y;
  }
  return moving.map((eid) => {
    const b = [...w.physics.bodies.values()].find((o) => o.id === w.c.StableId.value[eid])!;
    return { stair: b.stair, x: Position.x[eid]! };
  });
}

describe('stairs: simultaneous entry', () => {
  it('two bodies entering in the same tick: the first claims the entrance, the next queues', () => {
    const gap = DEFAULT_PHYSICS_CONFIG.stairs.spacing;
    for (const order of ['low-first', 'high-first'] as const) {
      const [first, second] = enterTogether(order);
      expect(first!.stair).toBe(1);
      // Never side by side on the flight: off it, or at least `spacing` behind.
      if (second!.stair === 1) expect(first!.x - second!.x).toBeGreaterThanOrEqual(gap - 1e-4);
      else expect(second!.x).toBeLessThan(20);
      expect(enterTogether(order)).toEqual([first, second]);
    }
  });
});
