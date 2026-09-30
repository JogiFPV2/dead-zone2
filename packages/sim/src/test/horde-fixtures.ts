import type { SimZombieSpawn } from '@deadzone/protocol';
import { DEFAULT_COMBAT_CONFIG } from '../combat/config.js';
import { createSim, type Sim } from '../sim.js';
import { fixtureContent } from './content-fixtures.js';
import { buildMap } from './fixtures.js';
import { NOON } from './ai-fixtures.js';

/**
 * Bench town (docs 8.4): 128 × 128 tiles, 7 × 7 blocks of 16 tiles with walls on the block edges
 * and two-tile openings in the middle of every side, so zombies must path around buildings.
 */
export const townMap = () =>
  buildMap({
    width: 128,
    height: 128,
    wallW: (x, y) => x % 16 === 0 && x > 0 && y % 16 !== 8 && y % 16 !== 9,
    wallN: (x, y) => y % 16 === 0 && y > 0 && x % 16 !== 8 && x % 16 !== 9,
  });

/** `count` zombies on a ring of tile centres 6–30 tiles around (64, 64), fixed pattern. */
export function hordeSpawns(count: number): SimZombieSpawn[] {
  const out: SimZombieSpawn[] = [];
  for (let i = 0; out.length < count; i++) {
    const x = 34 + ((i * 7) % 60);
    const y = 34 + ((i * 13 + (i >> 3)) % 60);
    const d = Math.sqrt((x - 64) ** 2 + (y - 64) ** 2);
    if (d < 6 || x % 16 === 0 || y % 16 === 0) continue;
    out.push({ x: x + 0.5, y: y + 0.5 });
  }
  return out;
}

const seqs = new WeakMap<Sim, number>();
const nextSeq = (sim: Sim): number => {
  const s = (seqs.get(sim) ?? 0) + 1;
  seqs.set(sim, s);
  return s;
};

/** Horde around the player at noon; loud noises at the player (every 5 s) pull everyone in. */
export function hordeSim(count: number, seed = 5): Sim {
  const sim = createSim({
    seed,
    map: townMap(),
    content: fixtureContent(),
    dev: true,
    clockStart: NOON,
    spawn: { x: 64.5, y: 64.5 },
    spawnZombies: hordeSpawns(count),
    // Zombies attack (the cost is measured) but never hit, so the chase goes on.
    combatConfig: {
      ...DEFAULT_COMBAT_CONFIG,
      zombie: { ...DEFAULT_COMBAT_CONFIG.zombie, hitChance: 0 },
    },
  });
  return sim;
}

/**
 * Player script: walks a slow circle (direction every 2 s from a fixed table, no Math.cos in
 * the input) and makes a loud noise every 5 s, like gunshots.
 */
const DIRS = [
  [1, 0],
  [0.7, 0.7],
  [0, 1],
  [-0.7, 0.7],
  [-1, 0],
  [-0.7, -0.7],
  [0, -1],
  [0.7, -0.7],
] as const;
export function stepScripted(sim: Sim): void {
  const t = sim.tick;
  if (t % 40 === 0) {
    const [dx, dy] = DIRS[(t / 40) % DIRS.length]!;
    sim.enqueue({
      type: 'move',
      tick: t,
      playerId: 0,
      seq: nextSeq(sim),
      dx: dx * 0.5,
      dy: dy * 0.5,
    });
  }
  if (t % 100 === 0) {
    const p = sim.getPlayer()!;
    sim.enqueue({
      type: 'debugNoise',
      tick: t,
      playerId: 0,
      seq: nextSeq(sim),
      x: Math.round(p.x * 16) / 16,
      y: Math.round(p.y * 16) / 16,
      radiusTiles: 120,
      volume: 1,
    });
  }
  sim.step();
}
