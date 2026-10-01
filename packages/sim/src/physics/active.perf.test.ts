import {
  CHUNK_SIZE,
  CHUNK_TILES,
  type SimChunk,
  type SimMap,
  type SimZombieSpawn,
} from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT_CONFIG } from '../combat/config.js';
import { createSim, type Sim } from '../sim.js';
import { NOON } from '../test/ai-fixtures.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { hordeSpawns, stepScripted } from '../test/horde-fixtures.js';

/**
 * 8 × 8 km map (250 × 250 chunks, 1 tile = 1 m): every chunk is the same bench-town chunk
 * (walls every 16 tiles with two-tile gaps, like `townMap`), served lazily from one shared chunk.
 */
const MAP_CHUNKS = 250;
function bigMap(): SimMap {
  const floor = new Uint16Array(CHUNK_TILES).fill(1);
  const edgeN = new Uint16Array(CHUNK_TILES);
  const edgeW = new Uint16Array(CHUNK_TILES);
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const i = y * CHUNK_SIZE + x;
      if (x % 16 === 0 && y % 16 !== 8 && y % 16 !== 9) edgeW[i] = 1;
      if (y % 16 === 0 && x % 16 !== 8 && x % 16 !== 9) edgeN[i] = 1;
    }
  }
  const chunk: SimChunk = { floor, edgeN, edgeW };
  return {
    getChunk: (cx, cy, z) =>
      z === 0 && cx >= 0 && cy >= 0 && cx < MAP_CHUNKS && cy < MAP_CHUNKS ? chunk : undefined,
  };
}

/** Player at the map centre; the bench horde (200) around it, `far` zombies spread over the map. */
const CX = 125 * CHUNK_SIZE;
function spawns(near: number, far: number): SimZombieSpawn[] {
  const out = hordeSpawns(near).map((s) => ({ x: s.x - 64 + CX, y: s.y - 64 + CX }));
  let r = 12345;
  const rnd = () => (r = (r * 1103515245 + 12345) >>> 0) / 2 ** 32;
  while (out.length < near + far) {
    const x = Math.floor(rnd() * MAP_CHUNKS * CHUNK_SIZE);
    const y = Math.floor(rnd() * MAP_CHUNKS * CHUNK_SIZE);
    if (x % 16 === 0 || y % 16 === 0) continue;
    if (Math.abs(x - CX) < 200 && Math.abs(y - CX) < 200) continue;
    out.push({ x: x + 0.5, y: y + 0.5 });
  }
  return out;
}

interface PerfHost {
  performance: { now(): number };
  process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };
}
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;
const tolerance = Number(host.process.env.PERF_TOLERANCE ?? (host.process.env.CI ? 1.5 : 1));

function measure(near: number, far: number): number {
  const sim: Sim = createSim({
    seed: 5,
    map: bigMap(),
    content: fixtureContent(),
    dev: true,
    clockStart: NOON,
    spawn: { x: CX + 0.5, y: CX + 0.5 },
    spawnZombies: spawns(near, far),
    combatConfig: {
      ...DEFAULT_COMBAT_CONFIG,
      zombie: { ...DEFAULT_COMBAT_CONFIG.zombie, hitChance: 0 },
    },
  });
  for (let i = 0; i < 200; i++) stepScripted(sim);
  const times: number[] = [];
  for (let i = 0; i < 600; i++) {
    const t0 = host.performance.now();
    stepScripted(sim);
    times.push(host.performance.now() - t0);
  }
  const batch = (b: number) => times.slice(b * 200, b * 200 + 200).reduce((a, t) => a + t, 0) / 200;
  const avg = Math.min(batch(0), batch(1), batch(2));
  host.process.stderr.write(
    `[perf] 8 km map, ${near} near + ${far} far: avg ${avg.toFixed(2)} ms\n`,
  );
  return avg;
}

describe('physics: active chunks (8 km map)', () => {
  it(
    '2000 bodies, 200 near the player: tick close to the 200-zombie budget',
    { timeout: 300_000 },
    () => {
      const only = measure(200, 0);
      const all = measure(200, 1800);
      // Budget: the 200-zombie AI budget (4 ms, `ai-perf`) + 25 %. Without freezing the same
      // world takes ~8 × the 200-only tick; now ~1.6 × (the rest is far-zombie AI thinking).
      expect(all).toBeLessThanOrEqual(4 * tolerance * 1.25);
      expect(all).toBeLessThanOrEqual(only * 2 + 0.5);
    },
  );
});
