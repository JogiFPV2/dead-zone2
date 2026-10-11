import { CHUNK_SIZE, MAP_CHUNKS, simMapFromWorldSource } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { createSim } from '../sim.js';
import { Rng } from '../core/rng.js';
import { fixtureContent } from './content-fixtures.js';
import { NOON } from './ai-fixtures.js';
import { gridWorld, lodSim } from './lod-fixtures.js';
import { stepScripted } from './horde-fixtures.js';
import { gzipSize, testLog, WORLD_CHUNKS, worldMapKind } from './world-map-fixture.js';
import { addCoarseZombies, ChunkLoot, chunkIndex, coarseTotal } from '../lod/state.js';
import { spawnChunkLoot } from '../lod/chunks.js';
import { generateLoot } from '../items/loot.js';
import { playerMapOf, roomKey } from '../map/player-map.js';

/**
 * docs 9.24 / 9.29: a 16 × 16 km world (512 × 512 chunks; the size is only `WorldSource.bounds`).
 * (1) memory of the far simulation, (2) tick time with ~200 000 coarse zombies, (3) save size of a
 * character after ~50 h of play (budget 2–3 MiB gzip per character; server 50 MiB per account =
 * 20 living characters). Numbers are printed (`[big]`); `PERF_TOLERANCE` as in ai-perf.
 */
interface PerfHost {
  performance: { now(): number };
  process: { env: Record<string, string | undefined> };
}
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;
const tolerance = Number(host.process.env.PERF_TOLERANCE ?? (host.process.env.CI ? 1.5 : 1));

const SIDE = MAP_CHUNKS;
const MID = SIDE / 2;
/** The 8 km test map tiled 2 × 2: same town density, four times the towns. */
const kind = (cx: number, cy: number) => worldMapKind(cx % WORLD_CHUNKS, cy % WORLD_CHUNKS);
const content = fixtureContent();

describe('16 × 16 km world (512 × 512 chunks)', () => {
  it('far simulation memory and tick time', { timeout: 300_000 }, () => {
    // No district kinds: `defaultZombiesPerChunk` everywhere (≈ 210 000 coarse zombies, stress).
    const world = gridWorld({ w: SIDE, h: SIDE, houseObjects: 4 });
    const sim = lodSim(world, MID, MID, {
      maxEntities: 8192,
      lod: { defaultZombiesPerChunk: 0.8, maxActiveZombies: 200, minSpawnDistTiles: 12 },
    });
    const w = sim.world;
    const lod = w.lod!;
    for (let cy = MID - 4; cy <= MID + 4; cy++)
      for (let cx = MID - 4; cx <= MID + 4; cx++) addCoarseZombies(lod, cx, cy, 0, 4);
    const all = coarseTotal(lod);
    // (1) Memory: the per-cell / per-chunk arrays (everything else is per visited chunk).
    const lodBytes =
      lod.counts.byteLength +
      lod.active.byteLength +
      lod.epoch.byteLength +
      lod.chunkLoot.byteLength;
    const fogBytes = playerMapOf(w.playerMap!, 1).bits.byteLength;
    expect(lod.wChunks).toBe(SIDE);
    expect(fogBytes).toBe((SIDE * SIDE) / 8);
    expect(lodBytes).toBeLessThan(4 * 1024 * 1024);
    // (2) Tick time.
    for (let i = 0; i < 300; i++) stepScripted(sim);
    const times: number[] = [];
    for (let i = 0; i < 600; i++) {
      const t0 = host.performance.now();
      stepScripted(sim);
      times.push(host.performance.now() - t0);
    }
    const batch = (b: number) =>
      times.slice(b * 200, b * 200 + 200).reduce((a, t) => a + t, 0) / 200;
    const avg = Math.min(batch(0), batch(1), batch(2));
    times.sort((a, b) => a - b);
    const s = sim.lodStats()!;
    testLog(
      `[big] 512×512: LOD arrays ${(lodBytes / 1024).toFixed(0)} KiB (${lod.types} zombie types), ` +
        `fog bitmap ${fogBytes} B; ${s.activeZombies} active + ${s.coarseZombies} coarse zombies, ` +
        `avg ${avg.toFixed(2)} ms/tick, p95 ${times[Math.floor(times.length * 0.95)]!.toFixed(2)} ms\n`,
    );
    expect(all).toBeGreaterThan(150_000);
    expect(s.activeZombies + s.coarseZombies).toBe(all);
    expect(avg).toBeLessThanOrEqual(4 * tolerance);
  });

  it(
    'save after ~50 h: 3000 changed chunks, drifted counters, full map ≤ 2.5 MiB gzip',
    {
      timeout: 600_000,
    },
    async () => {
      const world = gridWorld({ w: SIDE, h: SIDE, kind, houseObjects: 12 });
      const opts = {
        seed: 3,
        map: simMapFromWorldSource(world),
        world,
        content,
        clockStart: NOON,
        spawn: { x: MID * CHUNK_SIZE + 16.5, y: MID * CHUNK_SIZE + 16.5 },
        floorLoot: true,
        maxEntities: 8192,
        lod: { maxActiveZombies: 200, maxSpawnPerTick: 200 },
      };
      const sim = createSim(opts);
      for (let i = 0; i < 40; i++) sim.step();
      const w = sim.world;
      const lod = w.lod!;
      const st = w.items!;
      const rng = Rng.fromSeed(50);
      const sizes: string[] = [];
      let visited = 0;
      let gz = 0;
      // A long walk: rows of house chunks around the start (a 100-chunk wide band, back and
      // forth), every storage searched.
      const route: [number, number][] = [];
      for (let cy = MID - 50; cy < SIDE && route.length < 3000; cy++)
        for (let k = 0; k < 100 && route.length < 3000; k++) {
          const cx = cy % 2 === 0 ? MID - 50 + k : MID + 49 - k;
          if ((cx + cy) % 2 === 0) route.push([cx, cy]);
        }
      for (const target of [1000, 3000]) {
        for (; visited < target; visited++) {
          const [cx, cy] = route[visited]!;
          const i = chunkIndex(lod, cx, cy);
          if (lod.chunkLoot[i] === ChunkLoot.none) spawnChunkLoot(w, lod, cx, cy);
          lod.chunkLoot[i] = ChunkLoot.dirty;
          lod.chunkSig.delete(i);
          lod.epoch[i] = 1 + rng.int(0, 3);
        }
        for (const c of st.containers.values())
          if (c.kind === 'world') generateLoot(st, c, w.clock.startMinute);
        // 50 h of coarse drift: counters no longer match the start population anywhere.
        for (let c = 0; c < lod.counts.length; c++)
          if (lod.counts[c]! > 0 || rng.chance(0.2)) lod.counts[c] = rng.int(0, 6);
        // The character's map at its worst: random fog, full trail, all markers.
        const m = playerMapOf(w.playerMap!, w.c.StableId.value[w.players.get(0)!] ?? 0);
        for (let i = 0; i < m.bits.length; i++) m.bits[i] = rng.chance(0.5) ? rng.int(1, 255) : 0;
        m.trail.length = 0;
        let x = 8000;
        let y = 8000;
        for (let i = 0; i < 20_000; i++)
          m.trail.push((x += rng.int(-16, 16)), (y += rng.int(-16, 16)));
        for (let i = m.markers.size; i < 200; i++)
          m.markers.set(i + 1, {
            id: i + 1,
            x: 100 + i,
            y: 200,
            z: i % 3,
            icon: 'base:marker-loot',
            color: 'red',
            text: 'x'.repeat(40),
          });
        // Floor plan: 5000 rooms known (a few hundred buildings).
        for (let i = m.rooms.size; i < 5000; i++) {
          const r = {
            cx: 250 + (i % 70),
            cy: 250 + Math.floor(i / 70),
            z: i % 3,
            room: 1 + (i % 40),
          };
          m.rooms.set(roomKey(r.cx, r.cy, r.z, r.room), {
            ...r,
            state: i % 2 ? 'seen' : 'searched',
          });
        }
        const bytes = sim.save();
        gz = await gzipSize(bytes);
        sizes.push(
          `${visited} chunks / ${st.items.size} items: ${(bytes.length / 1048576).toFixed(2)} MiB raw, ` +
            `${(gz / 1048576).toFixed(2)} MiB gzip`,
        );
        if (target === 3000) {
          const back = createSim({ ...opts, load: bytes });
          expect(back.hash()).toBe(sim.hash());
        }
      }
      testLog(`[big] save 512×512 after ~50 h: ${sizes.join('; ')}\n`);
      expect(gz).toBeLessThan(2.5 * 1024 * 1024);
    },
  );
});
