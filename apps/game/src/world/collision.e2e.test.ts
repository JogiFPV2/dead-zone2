// End to end on the render map: test map -> SimMap adapter -> real sim movement and collisions.
import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, createSim } from '@deadzone/sim';
import { chunkSourceToSimMap } from './sim-map.js';
import { TEST_BUILDING, TEST_FENCE } from './test-building.js';
import { createTestMap } from './test-map.js';

/**
 * Walks player 0 from `spawn` along (dx, dy) for `seconds` and returns where it ended; `door`:
 * toggles that door (n edge) first.
 */
function walk(
  spawn: { x: number; y: number },
  dx: number,
  dy: number,
  seconds: number,
  door?: { tx: number; ty: number },
) {
  const sim = createSim({ seed: 1, map: chunkSourceToSimMap(createTestMap()), spawn });
  if (door) {
    sim.enqueue({ type: 'toggleDoor', ...door, side: 'n', tick: 0, playerId: 0, seq: 1 });
    sim.step();
  }
  sim.enqueue({ type: 'move', dx, dy, tick: sim.tick, playerId: 0, seq: 2 });
  for (let i = 0; i < seconds * 20; i++) sim.step();
  const p = sim.getPlayer(0);
  if (!p) throw new Error('no player');
  return p;
}

describe('test building collisions (sim + adapter)', () => {
  const { x0, y1 } = TEST_BUILDING;
  const south = y1 + 1; // line Z = 19: south outer wall

  it('walls block: walking east into the west wall stops at the wall', () => {
    const p = walk({ x: x0 - 3.5, y: 13.5 }, 1, 0, 3);
    expect(p.x).toBeLessThanOrEqual(x0 - PLAYER_RADIUS + 1e-3);
    expect(p.x).toBeGreaterThan(x0 - PLAYER_RADIUS - 0.05);
  });

  it('windows block: walking north into a south window stops outside', () => {
    const p = walk({ x: 15.5, y: south + 1.5 }, 0, -1, 3);
    expect(p.y).toBeGreaterThanOrEqual(south + PLAYER_RADIUS - 1e-3);
  });

  it('a closed door blocks; opened (toggleDoor) the player walks into the living room', () => {
    const shut = walk({ x: 13.5, y: south + 1 }, 0, -1, 1.5);
    expect(shut.y).toBeGreaterThanOrEqual(south + PLAYER_RADIUS - 1e-3);
    const open = walk({ x: 13.5, y: south + 1 }, 0, -1, 1.5, { tx: 13, ty: south });
    expect(open.y).toBeLessThan(south - 1);
  });

  it('the front-yard fence blocks walking', () => {
    const p = walk({ x: 12.5, y: TEST_FENCE.y + 1.5 }, 0, -1, 3);
    expect(p.y).toBeGreaterThanOrEqual(TEST_FENCE.y + PLAYER_RADIUS - 1e-3);
  });
});
