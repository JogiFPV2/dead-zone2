import { describe, expect, it } from 'vitest';
import {
  CHUNK_TILES,
  PROTOCOL_VERSION,
  decodeSnapshot,
  encodeSnapshot,
  ensureSnapshotBuffer,
  simMapFromData,
  simMapToData,
  snapshotByteLength,
  snapshotEntityCount,
  tileIndex,
} from './index.js';
import { parseCommand, parseMainToWorker } from './schema.js';

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
      { stableId: 1, x: 1.5, y: 2.25, z: 0, facingRad: 0.5 },
      { stableId: 7, x: -3, y: 4, z: 1, facingRad: 3 },
    ];
    const buf = encodeSnapshot(ents);
    expect(buf.byteLength).toBe(snapshotByteLength(2));
    expect(snapshotEntityCount(buf)).toBe(2);
    expect(decodeSnapshot(buf)).toEqual(ents);
  });

  it('has no header: 5 floats per entity, player first', () => {
    const buf = encodeSnapshot([{ stableId: 3, x: 1, y: 2, z: 0, facingRad: 0.25 }]);
    expect(Array.from(new Float32Array(buf))).toEqual([3, 1, 2, 0, 0.25]);
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
