import {
  CHUNK_SIZE,
  MAP_MARKER_ICONS,
  PLAYER_MAP_TRAIL_SPACING_M,
  SAVE_MARKER_COLORS,
  simMapFromWorldSource,
  type SimEvent,
} from '@deadzone/protocol';
import {
  MapMarkersSettingsSchema,
  MIN_TRAIL_SPACING_M,
  PlayerMapSettingsSchema,
} from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { MIDNIGHT, NOON } from '../test/ai-fixtures.js';
import { fixtureContent, send, survivalSim } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { gridWorld } from '../test/lod-fixtures.js';
import { gzipSize, testLog } from '../test/world-map-fixture.js';
import { fromBase64, utf8Decode, utf8Encode } from '../save/codec.js';
import { Rng } from '../core/rng.js';
import {
  decodeTrail,
  DEFAULT_PLAYER_MAP,
  encodeTrail,
  isDiscovered,
  playerMapOf,
  resetPlayerMap,
} from './player-map.js';

const big = (clockStart = NOON) =>
  survivalSim(undefined, {
    map: buildMap({ width: 8 * CHUNK_SIZE, height: 8 * CHUNK_SIZE }),
    spawn: { x: 3 * CHUNK_SIZE + 16.5, y: 3 * CHUNK_SIZE + 16.5 },
    clockStart,
  });
const of = <T extends SimEvent['type']>(evs: readonly SimEvent[], t: T) =>
  evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === t);
const myMap = (sim: Sim) =>
  playerMapOf(sim.world.playerMap!, sim.world.c.StableId.value[sim.world.players.get(0)!] ?? 0);
const popcount = (v: number): number => (v ? (v & 1) + popcount(v >> 1) : 0);
const bit = (b64: string, i: number): boolean =>
  ((fromBase64(b64)[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
const marker = (sim: Sim, p: Record<string, unknown>) =>
  sim.enqueue({ tick: sim.tick, playerId: 0, seq: 0, ...p } as never);

describe('player map: shared constants', () => {
  it('content defaults = the server lists (MAP_MARKER_ICONS, SAVE_MARKER_COLORS)', () => {
    const d = MapMarkersSettingsSchema.parse(undefined);
    expect(d.icons).toEqual([...MAP_MARKER_ICONS]);
    expect(d.colors).toEqual([...SAVE_MARKER_COLORS]);
    expect(DEFAULT_PLAYER_MAP.icons).toBe(MAP_MARKER_ICONS);
  });

  it('trail spacing: content minimum and default = the server constant (16 m)', () => {
    expect(MIN_TRAIL_SPACING_M).toBe(PLAYER_MAP_TRAIL_SPACING_M);
    expect(PlayerMapSettingsSchema.parse(undefined).trailSpacingM).toBe(PLAYER_MAP_TRAIL_SPACING_M);
    expect(DEFAULT_PLAYER_MAP.trailSpacingM).toBe(PLAYER_MAP_TRAIL_SPACING_M);
  });
});

describe('player map: save version', () => {
  it('a version 2 save (before playerMaps) loads with an empty map; new saves are version 3', () => {
    const a = big();
    for (let i = 0; i < 40; i++) a.step();
    const f = JSON.parse(utf8Decode(a.save())) as Record<string, unknown>;
    expect(f.version).toBe(3);
    expect(f.playerMaps).toBeDefined();
    f.version = 2;
    delete f.playerMaps;
    const b = survivalSim(undefined, {
      map: buildMap({ width: 8 * CHUNK_SIZE, height: 8 * CHUNK_SIZE }),
      clockStart: NOON,
      load: utf8Encode(JSON.stringify(f)),
    });
    expect(b.hash()).toBe(a.hash());
    expect(myMap(b).markers.size).toBe(0);
  });
});

describe('player map: fog of war', () => {
  it('discovers chunks within the sight range once a second; first view has the bitmap', () => {
    const sim = big();
    // The spawn area is discovered at creation: in the first view, no event.
    const view = sim.drainView()!.worldMap!;
    sim.step();
    expect(of(sim.drainEvents(), 'chunksDiscovered')).toEqual([]);
    expect(view.bounds).toEqual({ cx0: 0, cy0: 0, cx1: 7, cy1: 7 });
    expect(bit(view.discovered!, 3 * 8 + 3)).toBe(true);
    expect(bit(view.discovered!, 0)).toBe(false);
    expect(bit(view.discovered!, 3 * 8 + 6)).toBe(false);
    // Walk east: new chunks come as increments only.
    send(sim, { type: 'move', dx: 1, dy: 0, gait: 'run' });
    const added: [number, number][] = [];
    for (let i = 0; i < 20 * 20; i++) {
      sim.step();
      for (const e of of(sim.drainEvents(), 'chunksDiscovered')) added.push(...e.cells);
      const v = sim.drainView()?.worldMap;
      expect(v?.discovered).toBeUndefined();
    }
    expect(added).toContainEqual([5, 3]);
    expect(new Set(added.map(String)).size).toBe(added.length);
  });

  it('night shortens the sight range: fewer chunks discovered', () => {
    const count = (clock: typeof NOON) => {
      const sim = createSim({
        seed: 7,
        map: buildMap({ width: 8 * CHUNK_SIZE, height: 8 * CHUNK_SIZE }),
        spawn: { x: 3 * CHUNK_SIZE + 2.5, y: 3 * CHUNK_SIZE + 2.5 },
        content: fixtureContent(),
        clockStart: clock,
      });
      return [...myMap(sim).bits].reduce((n, v) => n + popcount(v), 0);
    };
    const day = count(NOON);
    const night = count(MIDNIGHT);
    expect(night).toBeGreaterThanOrEqual(1);
    expect(night).toBeLessThan(day);
  });

  it('dimensions come from the world source (250 × 250 chunks = 7813 bytes)', () => {
    const world = gridWorld({ w: 250, h: 250 });
    const sim = createSim({
      seed: 1,
      map: simMapFromWorldSource(world),
      world,
      content: fixtureContent(),
      spawn: { x: 100 * CHUNK_SIZE + 16.5, y: 120 * CHUNK_SIZE + 16.5 },
    });
    sim.step();
    expect(myMap(sim).bits.length).toBe(7813);
    expect(isDiscovered(sim.world.playerMap!, myMap(sim), 100, 120)).toBe(true);
  });
});

describe('player map: trail', () => {
  it('a point every 16 m (view: full, then appended points); compact delta codec', () => {
    const sim = big();
    sim.step();
    expect(sim.drainView()!.worldMap!.trail).toEqual([113, 113]);
    send(sim, { type: 'move', dx: 1, dy: 0, gait: 'run' });
    const add: number[] = [];
    for (let i = 0; i < 20 * 20; i++) {
      sim.step();
      add.push(...(sim.drainView()?.worldMap?.trailAdd ?? []));
    }
    // ~3.75 m/s × 20 s ≈ 70 m east: 4 points ≥ 16 m apart.
    expect(add.length / 2).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < add.length; i += 2) expect(add[i + 1]).toBe(113);
    const trail = myMap(sim).trail;
    expect(decodeTrail(encodeTrail(trail))).toEqual(trail);
    const long = Array.from({ length: 40_000 }, (_, i) => (i % 2 ? 4000 + ((i * 7) % 33) : 16 * i));
    expect(decodeTrail(encodeTrail(long))).toEqual(long);
  });
});

describe('player map: markers', () => {
  it('add / edit / remove apply at once without a tick (pause), no seq ordering', () => {
    const sim = big();
    expect(
      marker(sim, {
        type: 'addMarker',
        x: 50,
        y: 60,
        icon: 'base:marker-food',
        color: 'red',
        text: 'Sklep',
      }),
    ).toMatchObject({ ok: true });
    expect(
      marker(sim, { type: 'addMarker', x: 70, y: 60, icon: 'base:marker-car', color: 'blue' }),
    ).toMatchObject({ ok: true });
    let ev = of(sim.drainEvents(), 'markersChanged');
    expect(ev.map((e) => [e.change, e.changed])).toEqual([
      ['added', 1],
      ['added', 2],
    ]);
    expect(ev[1]!.markers).toEqual([
      { id: 1, x: 50, y: 60, icon: 'base:marker-food', color: 'red', text: 'Sklep' },
      { id: 2, x: 70, y: 60, icon: 'base:marker-car', color: 'blue', text: '' },
    ]);
    expect(
      marker(sim, { type: 'editMarker', id: 2, text: 'x'.repeat(100), color: 'white' }),
    ).toMatchObject({ ok: true });
    expect(marker(sim, { type: 'removeMarker', id: 1 })).toMatchObject({ ok: true });
    ev = of(sim.drainEvents(), 'markersChanged');
    expect(ev.at(-1)!.markers).toEqual([
      { id: 2, x: 70, y: 60, icon: 'base:marker-car', color: 'white', text: 'x'.repeat(40) },
    ]);
    expect(sim.tick).toBe(0);
    expect(sim.drainView()!.worldMap!.markers).toHaveLength(1);
  });

  it('rejects with codes: unknown icon / colour / outside the world, unknown id, limit', () => {
    const sim = big();
    const add = (p: Record<string, unknown>) =>
      marker(sim, {
        type: 'addMarker',
        x: 5,
        y: 5,
        icon: 'base:marker-note',
        color: 'green',
        ...p,
      });
    expect(add({ icon: 'base:marker-unicorn' })).toMatchObject({
      ok: false,
      reason: 'invalid-target',
    });
    expect(add({ color: 'pink' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(add({ x: 9999 })).toMatchObject({ ok: false, reason: 'invalid-target' });
    expect(marker(sim, { type: 'removeMarker', id: 9 })).toMatchObject({
      ok: false,
      reason: 'unknown-marker',
    });
    expect(marker(sim, { type: 'editMarker', id: 9, text: 'a' })).toMatchObject({
      ok: false,
      reason: 'unknown-marker',
    });
    for (let i = 0; i < 200; i++) expect(add({}).ok).toBe(true);
    expect(add({})).toMatchObject({ ok: false, reason: 'marker-limit' });
    expect(of(sim.drainEvents(), 'commandRejected').map((e) => e.reason)).toEqual([
      'invalid-target',
      'invalid-target',
      'unknown-marker',
      'unknown-marker',
      'marker-limit',
    ]);
  });
});

describe('player map: save, character', () => {
  it('round trip (fog, trail, markers); view resends everything after a load; size', async () => {
    const a = big();
    marker(a, {
      type: 'addMarker',
      x: 50,
      y: 60,
      icon: 'base:marker-base',
      color: 'yellow',
      text: 'Baza',
    });
    send(a, { type: 'move', dx: 1, dy: 0.3, gait: 'run' });
    for (let i = 0; i < 600; i++) a.step();
    const b = createSim({
      seed: 7,
      map: buildMap({ width: 8 * CHUNK_SIZE, height: 8 * CHUNK_SIZE }),
      content: fixtureContent(),
      dev: true,
      load: a.save(),
    });
    expect([...myMap(b).bits]).toEqual([...myMap(a).bits]);
    expect(myMap(b).trail).toEqual(myMap(a).trail);
    expect([...myMap(b).markers.values()]).toEqual([...myMap(a).markers.values()]);
    const v = b.drainView()!.worldMap!;
    expect(v.discovered).toBeDefined();
    expect(v.trail).toEqual(myMap(a).trail);
    expect(v.markers).toHaveLength(1);
    // Next marker id continues.
    marker(b, { type: 'addMarker', x: 1, y: 1, icon: 'base:marker-note', color: 'red' });
    expect(of(b.drainEvents(), 'markersChanged')[0]!.changed).toBe(2);

    // Worst case for the server: 250 × 250 chunks half discovered, 20 000 trail points, 200
    // markers with 40-character texts.
    const world = gridWorld({ w: 250, h: 250 });
    const s = createSim({
      seed: 1,
      map: simMapFromWorldSource(world),
      world,
      content: fixtureContent(),
      spawn: { x: 16.5, y: 16.5 },
      lod: { enabled: false },
    });
    const m = myMap(s);
    // Random bytes (no structure for gzip) and a random walk of 16 m steps.
    const rng = Rng.fromSeed(12345);
    for (let i = 0; i < m.bits.length; i++) m.bits[i] = rng.chance(0.5) ? rng.int(1, 255) : 0;
    let x = 4000;
    let y = 4000;
    for (let i = 0; i < 20_000; i++) {
      x += rng.int(-16, 16);
      y += rng.int(-16, 16);
      m.trail.push(x, y);
    }
    for (let i = 0; i < 200; i++)
      marker(s, {
        type: 'addMarker',
        x: 100 + i,
        y: 100,
        icon: 'base:marker-note',
        color: 'red',
        text: 'Ż'.repeat(40),
      });
    const json = JSON.parse(utf8Decode(s.save())) as {
      playerMaps: { discovered: string; trail: string }[];
    };
    testLog(
      `[size] fog ${json.playerMaps[0]!.discovered.length} B, trail ${json.playerMaps[0]!.trail.length} B base64\n`,
    );
    const bytes = utf8Encode(JSON.stringify(json.playerMaps));
    const gz = await gzipSize(bytes);
    testLog(
      `[size] player map worst case: ${(bytes.length / 1024).toFixed(1)} KiB JSON, ${(gz / 1024).toFixed(1)} KiB gzip\n`,
    );
    expect(bytes.length).toBeLessThan(120 * 1024);
  });

  it('a new character starts with an empty map', () => {
    const sim = big();
    marker(sim, { type: 'addMarker', x: 5, y: 5, icon: 'base:marker-note', color: 'red' });
    sim.step();
    const sid = sim.world.c.StableId.value[sim.world.players.get(0)!] ?? 0;
    expect(myMap(sim).trail.length).toBeGreaterThan(0);
    resetPlayerMap(sim.world, sid);
    expect(myMap(sim).trail).toEqual([]);
    expect(myMap(sim).markers.size).toBe(0);
    expect([...myMap(sim).bits].every((v) => v === 0)).toBe(true);
    expect(sim.drainView()!.worldMap!.discovered).toBeDefined();
  });
});
