import {
  CHUNK_SIZE,
  CHUNK_TILES,
  simMapFromWorldSource,
  type SimChunk,
  type SimMapObject,
  type WorldSource,
} from '@deadzone/protocol';
import type { ContentBundle } from '@deadzone/content';
import { createSim, type Sim, type SimOptions } from '../sim.js';
import type { SimLodConfig } from '../lod/state.js';
import { fixtureContent } from './content-fixtures.js';
import { NOON } from './ai-fixtures.js';

/**
 * Synthetic generated world for LOD tests: `w × h` chunks of open floor; every chunk with
 * `(cx + cy) % 2 === 0` has a kitchen (room 1, tiles 4..14) with `houseObjects` storage pieces.
 * Layers are shared, immutable arrays (cheap even at 250 × 250 chunks). Pure in (cx, cy, z).
 */
export function gridWorld(opts: {
  w: number;
  h: number;
  seed?: number;
  generatorVersion?: number;
  houseObjects?: number;
  kind?: (cx: number, cy: number) => string | undefined;
  /** Houses get a first floor (z 1) over the kitchen and a flight of stairs up. */
  floors?: boolean;
}): WorldSource {
  const floor = new Uint16Array(CHUNK_TILES).fill(1);
  const empty = new Uint16Array(CHUNK_TILES);
  const room = new Uint16Array(CHUNK_TILES);
  for (let y = 4; y <= 14; y++) for (let x = 4; x <= 14; x++) room[y * CHUNK_SIZE + x] = 1;
  const kinds = ['fixture:cabinet', 'fixture:fridge', 'fixture:cabinet', 'fixture:crate'];
  const objects: SimMapObject[] = [];
  for (let i = 0; i < (opts.houseObjects ?? 3); i++) {
    objects.push({
      contentId: kinds[i % kinds.length]!,
      x: 4 + (i % 10),
      y: 4 + Math.floor(i / 10),
    });
  }
  const house: SimChunk = {
    floor,
    edgeN: empty,
    edgeW: empty,
    room,
    rooms: { '1': 'fixture:room-kitchen' },
    objects,
  };
  const field: SimChunk = { floor, edgeN: empty, edgeW: empty };
  const upperFloor = new Uint16Array(CHUNK_TILES);
  for (let y = 4; y <= 14; y++) for (let x = 4; x <= 14; x++) upperFloor[y * CHUNK_SIZE + x] = 1;
  const upper: SimChunk = { floor: upperFloor, edgeN: empty, edgeW: empty };
  const houseUp: SimChunk = { ...house, stairs: [{ tx: 12, ty: 14, dir: 'N', len: 4 }] };
  return {
    seed: opts.seed ?? 77,
    generatorVersion: opts.generatorVersion ?? 1,
    bounds: { cx0: 0, cy0: 0, cx1: opts.w - 1, cy1: opts.h - 1, z0: 0, z1: opts.floors ? 1 : 0 },
    getChunk: (cx, cy, z) => {
      if (cx < 0 || cy < 0 || cx >= opts.w || cy >= opts.h) return undefined;
      const isHouse = (cx + cy) % 2 === 0;
      if (z === 0) return isHouse ? (opts.floors ? houseUp : house) : field;
      return z === 1 && opts.floors && isHouse ? upper : undefined;
    },
    ...(opts.kind ? { chunkKind: opts.kind } : {}),
  };
}

/** Sim over a generated world with LOD; player 0 at chunk (pcx, pcy) centre. */
export function lodSim(
  world: WorldSource,
  pcx: number,
  pcy: number,
  opts: Partial<SimOptions> & { lod?: Partial<SimLodConfig> } = {},
  content: ContentBundle = fixtureContent(),
): Sim {
  return createSim({
    seed: 11,
    map: simMapFromWorldSource(world),
    world,
    content,
    dev: true,
    clockStart: NOON,
    spawn: { x: pcx * CHUNK_SIZE + 16.5, y: pcy * CHUNK_SIZE + 16.5 },
    floorLoot: true,
    ...opts,
  });
}

// Per-sim command sequence numbers (part of the hash: two runs must send the same ones).
const seqs = new WeakMap<Sim, number>();
const nextSeq = (sim: Sim): number => {
  const s = (seqs.get(sim) ?? 0) + 1;
  seqs.set(sim, s);
  return s;
};

/** Walks player 0 in (dx, dy) for `ticks` ticks (a move command, then steps). */
export function walk(sim: Sim, dx: number, dy: number, ticks: number): void {
  sim.enqueue({ type: 'move', tick: sim.tick, playerId: 0, seq: nextSeq(sim), dx, dy });
  for (let i = 0; i < ticks; i++) sim.step();
}

/** Loud noise (gunshot-like) at (x, y) through the dev command. */
export function bang(sim: Sim, x: number, y: number, radiusTiles = 60): void {
  sim.enqueue({
    type: 'debugNoise',
    tick: sim.tick,
    playerId: 0,
    seq: nextSeq(sim),
    x,
    y,
    radiusTiles,
    volume: 1,
  });
}
