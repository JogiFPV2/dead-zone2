/**
 * Real sim saves for server tests: `createSim` on a small generated world with the base content,
 * a walk (trail, discovered chunks, LOD delta) and markers, then `sim.save()` (current
 * `SAVE_VERSION`). Generated once per test file; the JSON is what the client puts into a DZSV envelope.
 */
import { BASE_PACK_DIR, buildContentBundleFromDirs } from '@deadzone/content/node';
import {
  CHUNK_TILES,
  MAP_MARKER_ICONS,
  simMapFromWorldSource,
  type Command,
  type SimChunk,
  type WorldSource,
} from '@deadzone/protocol';
import { createSim } from '@deadzone/sim';

const content = await buildContentBundleFromDirs([BASE_PACK_DIR]);
const CHUNKS = 32;
const floor = new Uint16Array(CHUNK_TILES).fill(1);
const empty = new Uint16Array(CHUNK_TILES);
const field: SimChunk = { floor, edgeN: empty, edgeW: empty };

function world(seed: number): WorldSource {
  return {
    seed,
    generatorVersion: 1,
    bounds: { cx0: 0, cy0: 0, cx1: CHUNKS - 1, cy1: CHUNKS - 1, z0: 0, z1: 0 },
    getChunk: (cx, cy, z) =>
      z === 0 && cx >= 0 && cy >= 0 && cx < CHUNKS && cy < CHUNKS ? field : undefined,
  };
}

/** Seed of the one generated save; other seeds only rewrite the top-level `seed`. */
const BASE_SEED = 4242;
let cached: string | undefined;

/** UTF-8 JSON text of the real save (generated once, sim seed `BASE_SEED`). */
export function realSaveJson(): string {
  if (cached) return cached;
  cached = generate();
  return cached;
}

/**
 * Real save with one furniture water tank that is not full (protocol 36): the sim writes
 * `items.waterTanks` only then, so the tank state is set before `sim.save()`.
 */
export function realSaveWithTankJson(): string {
  return generate((sim) => {
    sim.world.items!.waterTanks = new Map([['11,10,0,0', Math.fround(3.5)]]);
  });
}

/**
 * Real save with one window cover (protocol 47): the sim writes `openings.covers` (a Map) as
 * `{ $m: [[openingKey, cover], …] }`.
 */
export function realSaveWithCoverJson(): string {
  return generate((sim) => {
    sim.world.openings.covers.set(4242, {
      item: 'base:blanket',
      lightPass: 0.25,
      blocksSight: true,
    });
  });
}

function generate(beforeSave?: (sim: ReturnType<typeof createSim>) => void): string {
  const seed = BASE_SEED;
  const src = world(seed);
  const sim = createSim({
    seed,
    map: simMapFromWorldSource(src),
    world: src,
    lod: {},
    content: content,
    spawn: { x: 200.5, y: 200.5 },
  });
  let seq = 0;
  const send = (cmd: Record<string, unknown>) =>
    sim.enqueue({ ...cmd, tick: sim.tick, playerId: 0, seq: seq++ } as unknown as Command);
  for (let t = 0; t < 1200; t++) {
    if (t === 2) {
      MAP_MARKER_ICONS.forEach((icon, i) =>
        send({
          type: 'addMarker',
          x: 210 + i * 10,
          y: 230,
          icon,
          color: 'red',
          text: `Znak ${i} 🍞`,
        }),
      );
    }
    if (t % 20 === 0) send({ type: 'move', dx: 1, dy: (t / 20) % 2 });
    sim.step();
  }
  beforeSave?.(sim);
  return new TextDecoder().decode(sim.save());
}

/**
 * Parsed real save (a fresh copy, safe to modify) for a character with `world_seed = seed`. The
 * server only checks that the sim seed equals the character's, so one generated save is reused.
 */
export const realSave = (seed: number): Record<string, unknown> => ({
  ...(JSON.parse(realSaveJson()) as Record<string, unknown>),
  seed,
});
