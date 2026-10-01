import { describe, expect, it } from 'vitest';
import {
  CHUNK_TILES,
  PROTOCOL_VERSION,
  decodeSnapshot,
  encodeSnapshot,
  SNAPSHOT_ENTITY_STRIDE,
  SnapshotAnim,
  SnapshotEntityKind,
  ensureSnapshotBuffer,
  simMapFromData,
  simMapToData,
  snapshotByteLength,
  snapshotEntityCount,
  tileIndex,
} from './index.js';
import { parseCommand, parseMainToWorker } from './schema.js';
import type { SimMapData } from './map.js';

it('exposes a positive integer protocol version', () => {
  expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  expect(PROTOCOL_VERSION).toBeGreaterThan(0);
});

describe('parseCommand', () => {
  const base = { tick: 3, playerId: 0, seq: 1 };

  it('accepts move and aim', () => {
    expect(parseCommand({ ...base, type: 'move', dx: 1, dy: -0.5 }).ok).toBe(true);
    expect(parseCommand({ ...base, type: 'aim', x: 10.5, y: -3 }).ok).toBe(true);
  });

  it('accepts survival commands', () => {
    for (const cmd of [
      { ...base, type: 'sleep' },
      { ...base, type: 'wake' },
      { ...base, type: 'bandage', part: 'forearm_l' },
      { ...base, type: 'bandage', part: 'head', itemId: 'base:bandage' },
      { ...base, type: 'debugWound', part: 'foot_r', wound: 'bite', zombie: true },
      { ...base, type: 'debugStat', stat: 'body-temperature-c', value: 36.5 },
    ]) {
      expect(parseCommand(cmd).ok, JSON.stringify(cmd)).toBe(true);
    }
  });

  it('accepts item and action commands', () => {
    for (const cmd of [
      { ...base, type: 'pickUp', item: 12 },
      { ...base, type: 'pickUp', item: 12, count: 3 },
      { ...base, type: 'drop', item: 12 },
      { ...base, type: 'moveItem', item: 12, to: 4, count: 1 },
      { ...base, type: 'equip', item: 12, slot: 'hand_primary' },
      { ...base, type: 'unequip', slot: 'back' },
      { ...base, type: 'openContainer', container: 4 },
      { ...base, type: 'closeContainer' },
      { ...base, type: 'useItem', item: 12 },
      { ...base, type: 'useItem', item: 12, part: 'hand_l' },
      { ...base, type: 'cancelAction' },
      { ...base, type: 'placeStorage', item: 12, x: -3, y: 40 },
      { ...base, type: 'pickUpStorage', container: 4 },
      { ...base, type: 'takeItem', container: 4, item: 12, count: 2 },
      { ...base, type: 'takeAll', container: 4 },
      { ...base, type: 'putItem', container: 4, item: 12 },
      { ...base, type: 'debugGiveItem', itemId: 'base:bandage', count: 5 },
      { ...base, type: 'move', dx: 1, dy: 0, gait: 'run' },
      { ...base, type: 'move', dx: 0, dy: 1, gait: 'sneak' },
      { ...base, type: 'debugSpawnZombie', x: 3.5, y: 4.5 },
      {
        ...base,
        type: 'debugSpawnZombie',
        x: 3.5,
        y: 4.5,
        z: 0,
        count: 20,
        zombieType: 'base:walker',
      },
      { ...base, type: 'debugNoise', x: 3.5, y: 4.5, radiusTiles: 30, volume: 0.5 },
    ]) {
      expect(parseCommand(cmd).ok, JSON.stringify(cmd)).toBe(true);
    }
  });

  it.each([
    ['negative item id', { ...base, type: 'pickUp', item: -1 }],
    ['zero count', { ...base, type: 'drop', item: 1, count: 0 }],
    ['fractional count', { ...base, type: 'moveItem', item: 1, to: 2, count: 1.5 }],
    ['unknown slot', { ...base, type: 'equip', item: 1, slot: 'tail' }],
    ['fractional tile', { ...base, type: 'placeStorage', item: 1, x: 0.5, y: 0 }],
    ['bad give id', { ...base, type: 'debugGiveItem', itemId: 'bandage' }],
    ['unknown body part', { ...base, type: 'bandage', part: 'tail' }],
    ['bad item id', { ...base, type: 'bandage', part: 'head', itemId: 'Bandage' }],
    ['unknown wound kind', { ...base, type: 'debugWound', part: 'head', wound: 'burn' }],
    ['unknown debug stat', { ...base, type: 'debugStat', stat: 'xp', value: 1 }],
    ['sleep with payload', { ...base, type: 'sleep', hours: 8 }],
    ['unknown gait', { ...base, type: 'move', dx: 0, dy: 0, gait: 'crawl' }],
    ['zero zombies', { ...base, type: 'debugSpawnZombie', x: 1, y: 1, count: 0 }],
    ['bad zombie type', { ...base, type: 'debugSpawnZombie', x: 1, y: 1, zombieType: 'Walker' }],
    ['noise volume > 1', { ...base, type: 'debugNoise', x: 1, y: 1, radiusTiles: 3, volume: 2 }],
  ])('rejects %s', (_name, input) => {
    expect(parseCommand(input).ok).toBe(false);
  });

  it.each([
    ['unknown type', { ...base, type: 'fly' }],
    ['dx out of range', { ...base, type: 'move', dx: 2, dy: 0 }],
    ['NaN', { ...base, type: 'move', dx: Number.NaN, dy: 0 }],
    ['Infinity aim', { ...base, type: 'aim', x: Infinity, y: 0 }],
    ['negative tick', { ...base, tick: -1, type: 'move', dx: 0, dy: 0 }],
    ['fractional seq', { ...base, seq: 1.5, type: 'move', dx: 0, dy: 0 }],
    ['missing playerId', { tick: 0, seq: 0, type: 'move', dx: 0, dy: 0 }],
    ['extra field', { ...base, type: 'move', dx: 0, dy: 0, teleport: true }],
    ['not an object', 'move'],
  ])('rejects %s', (_name, input) => {
    const r = parseCommand(input);
    expect(r.ok).toBe(false);
  });
});

describe('snapshot encoding', () => {
  it('round-trips entities and reports count', () => {
    const ents = [
      { stableId: 1, x: 1.5, y: 2.25, z: 0, facingRad: 0.5, kind: 1, anim: 2, hpPct: 0.5 },
      { stableId: 7, x: -3, y: 4, z: 1, facingRad: 3, kind: 2, anim: 0, hpPct: 0 },
    ];
    const buf = encodeSnapshot(ents);
    expect(buf.byteLength).toBe(snapshotByteLength(2));
    expect(snapshotEntityCount(buf)).toBe(2);
    expect(decodeSnapshot(buf)).toEqual(ents);
  });

  it('has no header: 8 floats per entity (kind, anim default 0, hpPct 1)', () => {
    expect(SNAPSHOT_ENTITY_STRIDE).toBe(8);
    const buf = encodeSnapshot([
      { stableId: 3, x: 1, y: 2, z: 0, facingRad: 0.25 },
      {
        stableId: 4,
        x: 1,
        y: 2,
        z: 0,
        facingRad: 0,
        kind: SnapshotEntityKind.zombie,
        anim: SnapshotAnim.run,
        hpPct: 0.25,
      },
    ]);
    expect(Array.from(new Float32Array(buf))).toEqual([
      3, 1, 2, 0, 0.25, 0, 0, 1, 4, 1, 2, 0, 0, 2, 2, 0.25,
    ]);
  });

  it('reuses a buffer only when its size matches exactly', () => {
    const three = new ArrayBuffer(snapshotByteLength(3));
    expect(ensureSnapshotBuffer(3, three)).toBe(three);
    expect(ensureSnapshotBuffer(2, three)).not.toBe(three);
    const one = new ArrayBuffer(snapshotByteLength(1));
    const out = encodeSnapshot([{ stableId: 1, x: 0, y: 0, z: 0, facingRad: 0 }], one);
    expect(out).toBe(one);
    expect(decodeSnapshot(out)).toHaveLength(1);
  });
});

describe('SimMapData', () => {
  const layer = () => new Uint16Array(CHUNK_TILES);

  it('round-trips through simMapFromData / simMapToData', () => {
    const floor = layer();
    floor[tileIndex(3, 4)] = 9;
    const map = simMapFromData({
      chunks: [{ cx: -1, cy: 0, z: 0, floor, edgeN: layer(), edgeW: layer() }],
    });
    expect(map.getChunk(-1, 0, 0)?.floor[tileIndex(3, 4)]).toBe(9);
    expect(map.getChunk(0, 0, 0)).toBeUndefined();
    const data = simMapToData(map, { cx0: -1, cy0: -1, cx1: 1, cy1: 1, z: 0 });
    expect(data.chunks).toHaveLength(1);
    expect(data.chunks[0]?.floor).not.toBe(floor);
  });

  it('carries rooms and map objects (world storage)', () => {
    const room = layer();
    room[tileIndex(1, 1)] = 1;
    const objects = [{ contentId: 'base:fridge', x: 1, y: 1 }];
    const map = simMapFromData({
      chunks: [
        {
          cx: 0,
          cy: 0,
          z: 0,
          floor: layer(),
          edgeN: layer(),
          edgeW: layer(),
          room,
          rooms: { '1': 'base:room-kitchen' },
          objects,
        },
      ],
    });
    expect(map.listChunks?.()).toEqual([{ cx: 0, cy: 0, z: 0 }]);
    expect(map.getChunk(0, 0, 0)?.objects).toEqual(objects);
    const data = simMapToData(map, { cx0: 0, cy0: 0, cx1: 0, cy1: 0, z: 0 });
    expect(data.chunks[0]).toMatchObject({ rooms: { '1': 'base:room-kitchen' }, objects });
    expect(parseMainToWorker({ kind: 'init', seed: 1, map: data }).ok).toBe(true);
    const bad = { ...data.chunks[0]!, objects: [{ contentId: 'fridge', x: 40, y: 0 }] };
    expect(parseMainToWorker({ kind: 'init', seed: 1, map: { chunks: [bad] } }).ok).toBe(false);
  });

  it('rejects malformed layers', () => {
    expect(() =>
      simMapFromData({
        chunks: [{ cx: 0, cy: 0, z: 0, floor: new Uint16Array(3), edgeN: layer(), edgeW: layer() }],
      }),
    ).toThrow();
  });
});

describe('parseMainToWorker', () => {
  it('accepts valid messages', () => {
    expect(parseMainToWorker({ kind: 'pause' }).ok).toBe(true);
    expect(parseMainToWorker({ kind: 'speed', x: 4 }).ok).toBe(true);
    expect(parseMainToWorker({ kind: 'init', seed: 1, map: { chunks: [] } }).ok).toBe(true);
    const spawn = { x: 5.5, y: 6.5, z: 0 };
    expect(parseMainToWorker({ kind: 'init', seed: 1, map: { chunks: [] }, spawn }).ok).toBe(true);
    expect(
      parseMainToWorker({
        kind: 'cmd',
        cmd: { tick: 0, playerId: 0, seq: 0, type: 'aim', x: 1, y: 1 },
      }).ok,
    ).toBe(true);
  });

  it('accepts init with zombies and a map with zones and an edge palette', () => {
    const map: SimMapData = {
      chunks: [],
      zones: [{ id: 'cellar', role: 'dark', z: 0, rects: [{ x: 1, y: 2, w: 3, h: 4 }] }],
      edgeKinds: [null, 'wall', 'window', 'door'],
    };
    const zombies = [
      { x: 3.5, y: 4.5 },
      { x: 5.5, y: 4.5, z: 0, type: 'base:walker' },
    ];
    expect(parseMainToWorker({ kind: 'init', seed: 1, map, zombies }).ok).toBe(true);
    expect(
      parseMainToWorker({ kind: 'init', seed: 1, map: { chunks: [], edgeKinds: ['fence'] } }).ok,
    ).toBe(false);
    expect(
      parseMainToWorker({ kind: 'init', seed: 1, map: { chunks: [] }, zombies: [{ x: 1 }] }).ok,
    ).toBe(false);
    const back = simMapToData(simMapFromData(map), { cx0: 0, cy0: 0, cx1: 0, cy1: 0, z: 0 });
    expect(back).toEqual(map);
  });

  it('accepts init with raw content packs and dev', () => {
    const content = {
      packs: [{ dir: 'base', files: [{ path: 'mod.json', json: { id: 'base' } }] }],
    };
    const init = { kind: 'init', seed: 1, map: { chunks: [] }, content, dev: true };
    expect(parseMainToWorker(init).ok).toBe(true);
    const bad = { packs: [{ dir: 'base', files: [{ path: 'mod.json' }] }] };
    expect(parseMainToWorker({ ...init, content: bad }).ok).toBe(false);
  });

  it('rejects invalid messages', () => {
    expect(parseMainToWorker({ kind: 'speed', x: 3 }).ok).toBe(false);
    const init = { kind: 'init', seed: 1, map: { chunks: [] } };
    expect(parseMainToWorker({ ...init, spawn: { x: 1, y: 1 } }).ok).toBe(false);
    expect(parseMainToWorker({ ...init, spawn: { x: NaN, y: 1, z: 0 } }).ok).toBe(false);
    expect(parseMainToWorker({ ...init, spawn: { x: 1, y: 1, z: 0.5 } }).ok).toBe(false);
    expect(parseMainToWorker({ kind: 'cmd', cmd: { type: 'move' } }).ok).toBe(false);
    expect(parseMainToWorker({ kind: 'nope' }).ok).toBe(false);
    expect(parseMainToWorker(null).ok).toBe(false);
  });
});
