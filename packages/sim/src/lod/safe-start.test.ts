import { describe, expect, it, vi } from 'vitest';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { gridWorld, lodSim } from '../test/lod-fixtures.js';
import { TileGrid } from '../world/grid.js';
import { lineOfSight } from '../world/los.js';
import type { Sim } from '../sim.js';
import { SAFE_START_RADIUS_TILES, SAFE_START_SEC, SAFE_START_SIGHT_TILES } from './safe-start.js';

// Heavy worlds (LOD, floors, long health runs): 5 s is too little on a busy shared box.
vi.setConfig({ testTimeout: 30_000 });

const PCX = 20;
const PCY = 20;

/** Closest zombie to player 0 and whether any zombie is in the player's line of sight. */
function exposure(sim: Sim, grid: TileGrid): { minD: number; seen: number } {
  const p = sim.getPlayer()!;
  let minD = Infinity;
  let seen = 0;
  for (const z of sim.getZombies()) {
    const d = Math.sqrt((z.x - p.x) ** 2 + (z.y - p.y) ** 2);
    minD = Math.min(minD, d);
    if (
      d < SAFE_START_SIGHT_TILES &&
      Math.floor(z.z) === Math.floor(p.z) &&
      lineOfSight(grid, Math.floor(p.z), p.x, p.y, z.x, z.y)
    )
      seen++;
  }
  return { minD, seen };
}

function start(safe: boolean): Sim {
  const sx = PCX * 32 + 16.5;
  const sy = PCY * 32 + 16.5;
  return lodSim(gridWorld({ w: 40, h: 40 }), PCX, PCY, {
    lod: { defaultZombiesPerChunk: 3, minSpawnDistTiles: 8 },
    // Start list right next to the player (generated maps frame a few around the start).
    spawnZombies: [
      { x: sx + 6, y: sy },
      { x: sx - 12, y: sy + 3 },
      { x: sx, y: sy + 25 },
    ],
    ...(safe ? { safeStart: {} } : {}),
  });
}

describe('safe start (generated maps)', () => {
  // 2000 ticks of a populated LOD world: ~10 s on a loaded box.
  it(
    'no zombie within 40 m or in sight for the first 60 s, then the world fills in',
    { timeout: 60_000 },
    () => {
      const sim = start(true);
      const grid = new TileGrid(sim.world.map, sim.world.openings);
      expect(exposure(sim, grid).minD).toBeGreaterThanOrEqual(SAFE_START_RADIUS_TILES);
      const ticks = SAFE_START_SEC * TICKS_PER_SECOND;
      let worstD = Infinity;
      let maxSeen = 0;
      for (let i = 0; i < ticks; i++) {
        sim.step();
        const e = exposure(sim, grid);
        worstD = Math.min(worstD, e.minD);
        maxSeen = Math.max(maxSeen, e.seen);
      }
      expect(worstD).toBeGreaterThanOrEqual(SAFE_START_RADIUS_TILES);
      expect(maxSeen).toBe(0);
      // The area is not empty: zombies stand further out (behind walls), none was lost.
      expect(sim.lodStats()!.activeZombies).toBeGreaterThan(20);
      expect(sim.tick).toBe(ticks);
      // After the protection ends, LOD spawns use the normal minimum distance again.
      for (let i = 0; i < 40 * TICKS_PER_SECOND; i++) sim.step();
      expect(exposure(sim, grid).minD).toBeLessThan(SAFE_START_RADIUS_TILES);
    },
  );

  it('without it (handmade maps) zombies come close at start', { timeout: 30_000 }, () => {
    const sim = start(false);
    const grid = new TileGrid(sim.world.map, sim.world.openings);
    let worstD = Infinity;
    for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) {
      sim.step();
      worstD = Math.min(worstD, exposure(sim, grid).minD);
    }
    expect(worstD).toBeLessThan(SAFE_START_RADIUS_TILES);
  });

  it('removes a zombie that appears close while protected', () => {
    const sim = start(true);
    sim.step();
    const p = sim.getPlayer()!;
    sim.enqueue({
      type: 'debugSpawnZombie',
      tick: sim.tick,
      playerId: 0,
      seq: 1,
      x: p.x + 5,
      y: p.y,
    });
    sim.step();
    sim.step();
    for (const z of sim.getZombies())
      expect(Math.sqrt((z.x - p.x) ** 2 + (z.y - p.y) ** 2)).toBeGreaterThanOrEqual(
        SAFE_START_RADIUS_TILES,
      );
  });
});
