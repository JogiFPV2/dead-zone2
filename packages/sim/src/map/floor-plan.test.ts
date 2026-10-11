import {
  CHUNK_SIZE,
  type RoomIntelView,
  type SimEvent,
  type ZombieSightingView,
} from '@deadzone/protocol';
import { saveMapRoomsSchema, saveMarkersSchema } from '@deadzone/protocol/schema';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { DEFAULT_STAGE4_CONFIG } from '../ai/config.js';
import { NOON } from '../test/ai-fixtures.js';
import { fixtureContent, send } from '../test/content-fixtures.js';
import { buildMap, type MapSpec } from '../test/fixtures.js';
import { tileKey } from '../items/store.js';
import { utf8Decode, utf8Encode } from '../save/codec.js';
import { decodeRooms, encodeRooms, playerMapOf, type MapRoom } from './player-map.js';

// Chunk (1, 1): kitchen (room 1, x 40–47) with two cabinets, hall (room 2, x 48–55), both
// y 40–47, open between them. Pantry (room 3, x 40–47, y 52–55) behind a wall at y = 52.
// Room 4 (x 60–62, y 40–42): no storages.
const wallN = (x: number, y: number) => y === 52 && x >= 40 && x < 48;
const SPEC: MapSpec = {
  width: 4 * CHUNK_SIZE,
  height: 4 * CHUNK_SIZE,
  levels: 2,
  wallN,
  room: (x, y) =>
    y >= 40 && y < 48 && x >= 40 && x < 56
      ? x < 48
        ? 1
        : 2
      : y >= 52 && y < 56 && x >= 40 && x < 48
        ? 3
        : x >= 60 && x < 63 && y >= 40 && y < 43
          ? 4
          : 0,
  rooms: { '1': 'fixture:room-kitchen', '2': 'fixture:room-hall', '3': 'fixture:room-hall' },
  objects: [
    { contentId: 'fixture:cabinet', x: 43, y: 44 },
    { contentId: 'fixture:cabinet', x: 45, y: 44 },
  ],
};

const DEAF = {
  ...DEFAULT_STAGE4_CONFIG,
  ai: { ...DEFAULT_STAGE4_CONFIG.ai, wanderRadiusTiles: 0 },
};

const make = (
  o: {
    load?: Uint8Array;
    spawn?: { x: number; y: number };
    zombies?: { x: number; y: number }[];
  } = {},
): Sim =>
  createSim({
    seed: 7,
    map: buildMap(SPEC),
    spawn: o.spawn ?? { x: 44.5, y: 44.5 },
    content: fixtureContent(),
    dev: true,
    clockStart: NOON,
    aiConfig: DEAF,
    ...(o.zombies ? { spawnZombies: o.zombies } : {}),
    ...(o.load ? { load: o.load } : {}),
  });

/** Full room state as the client would build it from `rooms` + `roomsAdd`. */
function track(sim: Sim, known = new Map<string, RoomIntelView>()) {
  for (let v = sim.drainView(); v; v = sim.drainView()) {
    const wm = v.worldMap;
    if (wm?.rooms) known.clear();
    for (const r of [...(wm?.rooms ?? []), ...(wm?.roomsAdd ?? [])])
      known.set(`${r.cx},${r.cy},${r.z},${r.room}`, r);
  }
  return known;
}
const stateOf = (k: Map<string, RoomIntelView>, room: number) => k.get(`1,1,0,${room}`)?.state;

function searchAt(sim: Sim, x: number, y: number): void {
  const id = sim.world.items!.worldByTile.get(tileKey(x, y, 0))![0]!;
  send(sim, { type: 'search', container: id });
  const evs: SimEvent[] = [];
  for (let i = 0; i < 4000 && !evs.some((e) => e.type === 'containerOpened'); i++) {
    sim.step();
    evs.push(...sim.drainEvents());
  }
  expect(evs.some((e) => e.type === 'containerOpened')).toBe(true);
}

const marker = (sim: Sim, p: Record<string, unknown>) =>
  sim.enqueue({ tick: sim.tick, playerId: 0, seq: 0, ...p } as never);

describe('player map: floor plan rooms', () => {
  it('rooms in sight are seen; walls hide; a room without storages is searched once stood in', () => {
    const sim = make();
    const k = track(sim);
    expect(stateOf(k, 1)).toBe('seen');
    expect(stateOf(k, 2)).toBe('seen');
    expect(stateOf(k, 3)).toBeUndefined();
    expect(stateOf(k, 4)).toBe('seen');
    // The first view has the full list; later changes come as `roomsAdd` only.
    sim.step();
    expect(sim.drainView()?.worldMap?.rooms).toBeUndefined();
    const hall = make({ spawn: { x: 50.5, y: 44.5 } });
    expect(stateOf(track(hall), 2)).toBe('searched');
  });

  it('searching every storage makes the room searched (roomsAdd)', () => {
    const sim = make();
    const k = track(sim);
    searchAt(sim, 43, 44);
    track(sim, k);
    expect(stateOf(k, 1)).toBe('seen');
    searchAt(sim, 45, 44);
    let add: RoomIntelView[] | undefined;
    for (let v = sim.drainView(); v; v = sim.drainView()) add = v.worldMap?.roomsAdd ?? add;
    expect(add).toEqual([{ cx: 1, cy: 1, z: 0, room: 1, state: 'searched' }]);
  });

  it('rooms are saved compactly and restored; older saves without rooms load', () => {
    const sim = make();
    searchAt(sim, 43, 44);
    searchAt(sim, 45, 44);
    const before = track(sim);
    const bytes = sim.save();
    const json = JSON.parse(utf8Decode(bytes)) as { playerMaps: { rooms?: string }[] };
    const saved = json.playerMaps[0]!.rooms!;
    expect(saveMapRoomsSchema.safeParse(saved).success).toBe(true);
    expect(saved.length).toBeLessThan(32);
    expect([...track(make({ load: bytes })).values()]).toEqual([...before.values()]);
    delete json.playerMaps[0]!.rooms;
    const old = make({ load: utf8Encode(JSON.stringify(json)) });
    expect(track(old).size).toBe(0);
    for (let i = 0; i < 20; i++) old.step();
    // Seen again at the next map update; searches are counted again.
    expect(stateOf(track(old), 1)).toBe('searched');
  });

  it('encodeRooms / decodeRooms round trip; bad data throws', () => {
    const list: MapRoom[] = [
      { cx: -3, cy: 2, z: -1, room: 5, state: 'seen' },
      { cx: 4, cy: 2, z: 0, room: 65535, state: 'searched' },
    ];
    expect(decodeRooms(encodeRooms(list))).toEqual(list);
    expect(() => decodeRooms('AAAAAAAA')).toThrow();
  });
});

describe('player map: sensed zombies and sightings', () => {
  it('seen in sight, heard close behind a wall, hidden far behind a wall; sightings kept', () => {
    const sim = make({
      spawn: { x: 44.5, y: 50.5 },
      zombies: [
        { x: 50.5, y: 44.5 }, // seen (open floor)
        { x: 44.5, y: 54.5 }, // behind the pantry wall, 4 tiles: heard
        { x: 46.5, y: 55.5 }, // pantry too, but... still within 6 tiles: heard
        { x: 44.5, y: 75.5 }, // far: none
      ],
    });
    const sids = sim.getZombies().map((z) => z.stableId);
    sim.step();
    let sensed: number[] | undefined;
    let sightings: ZombieSightingView[] | undefined;
    for (let v = sim.drainView(); v; v = sim.drainView()) {
      sensed = v.sensedZombies ?? sensed;
      sightings = v.worldMap?.zombieSightings ?? sightings;
    }
    expect(sensed).toEqual([sids[0], sids[1], sids[2]]);
    expect(sightings).toHaveLength(3);
    expect(sightings?.[0]).toMatchObject({ z: 0, tick: 0 });
  });
});

describe('player map: marker floors', () => {
  it('addMarker z defaults to 0; z within the world floors; saved when not 0', () => {
    const sim = make();
    const base = { type: 'addMarker', x: 5, y: 5, icon: 'base:marker-note', color: 'red' };
    expect(marker(sim, base)).toMatchObject({ ok: true });
    expect(marker(sim, { ...base, z: 1 })).toMatchObject({ ok: true });
    expect(marker(sim, { ...base, z: 2 })).toMatchObject({ ok: false, reason: 'invalid-target' });
    expect(marker(sim, { type: 'editMarker', id: 1, z: 1 })).toMatchObject({ ok: true });
    expect(marker(sim, { type: 'editMarker', id: 2, text: 'x' })).toMatchObject({ ok: true });
    let last;
    for (let v = sim.drainView(); v; v = sim.drainView()) last = v.worldMap?.markers ?? last;
    expect(last?.map((m) => m.z)).toEqual([1, 1]);
    marker(sim, { type: 'editMarker', id: 1, z: 0 });
    const json = JSON.parse(utf8Decode(sim.save())) as { playerMaps: { markers: unknown[][] }[] };
    const saved = json.playerMaps[0]!.markers;
    expect(saved).toEqual([
      [1, 5, 5, 'base:marker-note', 'red', ''],
      [2, 5, 5, 'base:marker-note', 'red', 'x', true, 1],
    ]);
    expect(saveMarkersSchema.safeParse(saved).success).toBe(true);
    const loaded = make({ load: sim.save() });
    const sid = loaded.world.c.StableId.value[loaded.world.players.get(0)!] ?? 0;
    const ms = playerMapOf(loaded.world.playerMap!, sid).markers;
    expect([ms.get(1)!.z, ms.get(2)!.z]).toEqual([0, 1]);
  });
});
