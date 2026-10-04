import {
  CHUNK_SIZE,
  simMapFromWorldSource,
  type Command,
  type WorldSource,
} from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { fixtureContent, survivalSim } from '../test/content-fixtures.js';
import { NOON } from '../test/ai-fixtures.js';
import { gridWorld } from '../test/lod-fixtures.js';
import { gzipSize, testLog, worldMapKind, START_CHUNK } from '../test/world-map-fixture.js';
import { checkSave, SaveError } from '../save/save.js';
import { utf8Decode, utf8Encode } from '../save/codec.js';
import { decodeZeroRle, encodeZeroRle, zeroRleStats } from '../save/delta.js';
import { generateLoot } from '../items/loot.js';
import { spawnChunkLoot } from './chunks.js';
import { ChunkLoot, chunkIndex } from './state.js';

const content = fixtureContent();
const open = (world: WorldSource, load?: Uint8Array, lod = { defaultZombiesPerChunk: 1.5 }): Sim =>
  createSim({
    seed: 11,
    map: simMapFromWorldSource(world),
    world,
    content,
    dev: true,
    clockStart: NOON,
    spawn: { x: 20 * CHUNK_SIZE + 16.5, y: 20 * CHUNK_SIZE + 16.5 },
    floorLoot: true,
    walkSpeedTilesPerSecond: 12,
    lod,
    ...(load ? { load } : {}),
  });

type Payload = Command extends infer C
  ? C extends Command
    ? Omit<C, 'tick' | 'playerId' | 'seq'>
    : never
  : never;
/** Same command (same seq) to every sim. */
function sendAll(sims: Sim[], seq: number, p: Payload): void {
  for (const s of sims) s.enqueue({ ...p, tick: s.tick, playerId: 0, seq });
}

/** Script: walk a zig-zag over several chunks with a gunshot now and then. */
function script(sims: Sim[], from: number, ticks: number, hashes: number[][]): void {
  for (let t = from; t < from + ticks; t++) {
    if (t % 120 === 0) {
      const dirs = [
        [1, 0],
        [0, 1],
        [-1, 0.3],
        [0.2, -1],
      ] as const;
      const [dx, dy] = dirs[(t / 120) % 4]!;
      sendAll(sims, t + 1, { type: 'move', dx, dy });
    }
    if (t % 300 === 150) {
      const p = sims[0]!.getPlayer()!;
      sendAll(sims, t + 2, { type: 'debugNoise', x: p.x, y: p.y, radiusTiles: 60, volume: 1 });
    }
    for (const s of sims) s.step();
    if (t % 100 === 0) sims.forEach((s, i) => (hashes[i] ??= []).push(s.hash()));
  }
}

describe('world save (delta)', () => {
  it('zero-run varint codec round-trips', () => {
    const a = new Uint16Array(5000);
    a[3] = 1;
    a[4] = 300;
    a[4999] = 65535;
    const s = encodeZeroRle(a);
    const b = new Uint16Array(5000);
    decodeZeroRle(s, b);
    expect(b).toEqual(a);
    expect(s.length).toBeLessThan(40);
    expect(() => decodeZeroRle(s, new Uint16Array(10))).toThrow();
    expect(zeroRleStats(s, 5000)).toEqual({ length: 5000, max: 65535 });
    expect(() => zeroRleStats(s, 4999)).toThrow();
    expect(() => zeroRleStats('gA==', 5000)).toThrow(); // [0x80]: truncated varint
  });

  it(
    'save → load: generator(seed, version) + delta gives the same state and the same future',
    { timeout: 120_000 },
    () => {
      const world = gridWorld({ w: 48, h: 48 });
      const a = open(world);
      const pre: number[][] = [];
      script([a], 0, 1500, pre);
      const bytes = a.save();
      const b = open(world, bytes);
      expect(b.hash()).toBe(a.hash());
      expect(b.lodStats()).toEqual(a.lodStats());
      expect(utf8Decode(b.save())).toBe(utf8Decode(bytes));
      const hashes: number[][] = [];
      script([a, b], 1500, 1500, hashes);
      expect(hashes[1]).toEqual(hashes[0]);
      expect(b.lodStats()!.dirtyChunks + b.lodStats()!.liveChunks).toBeGreaterThan(49);
    },
  );

  it('stairs of generated chunks are registered lazily and keep their ids after a load', () => {
    const world = gridWorld({ w: 30, h: 30, floors: true });
    const a = open(world, undefined, { defaultZombiesPerChunk: 0.5 });
    a.step();
    expect(a.world.physics.stairs.length).toBe(25);
    expect(a.world.physics.multiLevel).toBe(true);
    const hashes: number[][] = [];
    script([a], 1, 900, hashes);
    const b = open(world, a.save(), { defaultZombiesPerChunk: 0.5 });
    const ids = (s: Sim) => s.world.physics.stairs.map((st) => `${st.id}:${st.tx},${st.ty}`);
    expect(ids(b)).toEqual(ids(a));
    expect(ids(a).length).toBeGreaterThan(25);
    const after: number[][] = [];
    script([a, b], 901, 600, after);
    expect(after[1]).toEqual(after[0]);
  }, 60_000);

  it('refuses a save from another generator version with a code (migration hook accepts it)', () => {
    const bytes = open(gridWorld({ w: 48, h: 48 })).save();
    const v2 = gridWorld({ w: 48, h: 48, generatorVersion: 2 });
    const r = checkSave(bytes, v2);
    expect(r).toMatchObject({ ok: false, code: 'generator-version' });
    let err: unknown;
    try {
      open(v2, bytes);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SaveError);
    expect((err as SaveError).code).toBe('generator-version');
    const migrating = { ...v2, acceptsGeneratorVersion: (v: number) => v === 1 };
    expect(checkSave(bytes, migrating).ok).toBe(true);
    expect(() => open(migrating, bytes)).not.toThrow();
    expect(checkSave(bytes, gridWorld({ w: 48, h: 48, seed: 5 }))).toMatchObject({
      ok: false,
      code: 'world-seed',
    });
    expect(checkSave(utf8Encode('{"hello":1}'))).toMatchObject({ ok: false, code: 'not-a-save' });
    expect(checkSave(Uint8Array.of(1, 2, 3))).toMatchObject({ ok: false, code: 'not-a-save' });
  });

  it('version 1 saves (before the world header) still load on the demo map', () => {
    const a = survivalSim();
    for (let i = 0; i < 50; i++) a.step();
    const f = JSON.parse(utf8Decode(a.save())) as Record<string, unknown>;
    delete f.world;
    f.version = 1;
    const v1 = utf8Encode(JSON.stringify(f));
    const b = survivalSim(undefined, { load: v1 });
    expect(b.hash()).toBe(a.hash());
  });

  it(
    'budget: 300 visited chunks + 250×250 cells fit in 2–3 MiB gzip',
    { timeout: 120_000 },
    async () => {
      const world = gridWorld({ w: 250, h: 250, kind: worldMapKind, houseObjects: 12 });
      const sim = createSim({
        seed: 3,
        map: simMapFromWorldSource(world),
        world,
        content,
        clockStart: NOON,
        spawn: { x: START_CHUNK.cx * CHUNK_SIZE + 16.5, y: START_CHUNK.cy * CHUNK_SIZE + 16.5 },
        floorLoot: true,
        maxEntities: 8192,
        lod: { maxActiveZombies: 200, maxSpawnPerTick: 200 },
      });
      for (let i = 0; i < 40; i++) sim.step();
      const w = sim.world;
      const lod = w.lod!;
      const st = w.items!;
      // 300 visited house chunks along the route, every storage searched (all loot generated).
      let visited = 0;
      for (let cy = 100; cy < 250 && visited < 300; cy++) {
        for (let cx = 0; cx < 250 && visited < 300; cx += 2) {
          if ((cx + cy) % 2 !== 0) continue;
          const i = chunkIndex(lod, cx, cy);
          if (lod.chunkLoot[i] === ChunkLoot.none) spawnChunkLoot(w, lod, cx, cy);
          lod.chunkLoot[i] = ChunkLoot.dirty;
          lod.chunkSig.delete(i);
          visited++;
        }
      }
      for (const c of st.containers.values())
        if (c.kind === 'world') generateLoot(st, c, w.clock.startMinute);
      const bytes = sim.save();
      const gz = await gzipSize(bytes);
      const stats = sim.lodStats()!;
      testLog(
        `[lod] save: ${visited} dirty chunks, ${st.items.size} items, ${st.containers.size} containers, ` +
          `${stats.activeZombies} active + ${stats.coarseZombies} coarse zombies → ` +
          `${(bytes.length / 1024).toFixed(0)} KiB raw, ${(gz / 1024).toFixed(0)} KiB gzip\n`,
      );
      expect(stats.activeZombies).toBeGreaterThan(100);
      expect(gz).toBeLessThan(2.5 * 1024 * 1024);
      // Loads back to the same state.
      const back = createSim({
        seed: 3,
        map: simMapFromWorldSource(world),
        world,
        content,
        clockStart: NOON,
        floorLoot: true,
        maxEntities: 8192,
        lod: { maxActiveZombies: 200, maxSpawnPerTick: 200 },
        load: bytes,
      });
      expect(back.hash()).toBe(sim.hash());
    },
  );
});
