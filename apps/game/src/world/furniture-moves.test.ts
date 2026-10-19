import { describe, expect, it } from 'vitest';
import type { FurnitureMoveView } from '@deadzone/protocol';
import { CHUNK_TILES, type ChunkData } from './chunk.js';
import { footprintsOn, surfacesOf } from './furniture-footprint.js';
import {
  FURNITURE_TWEEN_MS,
  FurnitureMoves,
  carriedPose,
  movedChunks,
  objectId,
  poseBefore,
  turnTo,
  unpackObjectId,
  type FurnitureMovedEvent,
} from './furniture-moves.js';
import { MapObjects } from './map-objects.js';

const moved = (p: Partial<FurnitureMovedEvent> = {}): FurnitureMovedEvent => ({
  type: 'furnitureMoved',
  tick: 10,
  cause: 'push',
  playerId: 0,
  contentId: 'base:sofa',
  fromId: objectId(2, 3, 0, 0),
  toId: objectId(3, 3, 0, 0),
  fromX: 2,
  fromY: 3,
  x: 3,
  y: 3,
  z: 0,
  rot: 0,
  w: 2,
  h: 1,
  carried: [],
  ...p,
});

const view = (p: Partial<FurnitureMoveView> = {}): FurnitureMoveView => ({
  contentId: 'base:sofa',
  fromX: 2,
  fromY: 3,
  fromRot: 0,
  x: 3,
  y: 3,
  z: 0,
  rot: 0,
  w: 2,
  h: 1,
  id: objectId(3, 3, 0, 0),
  ...p,
});

const pose = (tx: number, ty: number, rot = 0) => ({ contentId: 'base:sofa', tx, ty, z: 0, rot });

describe('object ids (sim furniture/menu.ts)', () => {
  it('packs the anchor tile and the index on it, negative tiles too', () => {
    expect(unpackObjectId(objectId(-40, 7, 1, 3))).toEqual({ x: -40, y: 7, z: 1, n: 3 });
    expect(unpackObjectId(objectId(0, -1, 0, 0))).toEqual({ x: 0, y: -1, z: 0, n: 0 });
  });
});

describe('FurnitureMoves (overlay over the map data)', () => {
  it('follows a piece over several live moves by its map place; a repeat changes nothing', () => {
    const m = new FurnitureMoves();
    expect(m.move(pose(2, 3), { ...pose(3, 3), w: 2, h: 1 })).toBe(true);
    expect(m.move(pose(2, 3), { ...pose(3, 3), w: 2, h: 1 })).toBe(false);
    m.move(pose(3, 3), { ...pose(3, 3, 1), w: 1, h: 2 });
    expect(m.size).toBe(1);
    expect(m.keepsMapPlace('base:sofa', 2, 3, 0)).toBe(false);
    expect(m.keepsMapPlace('base:sofa', 6, 3, 0)).toBe(true);
    expect(m.movedInto(0, 0, 0)).toEqual([{ ...pose(3, 3, 1), w: 1, h: 2 }]);
    expect(m.movedInto(0, 0, 1)).toEqual([]);
  });

  it('full list (c): replaces the overlay, idempotent, back on the map place = shift home', () => {
    const m = new FurnitureMoves();
    expect(m.setAll([view()])).toEqual([{ from: pose(2, 3), to: { ...pose(3, 3), w: 2, h: 1 } }]);
    expect(m.setAll([view()])).toEqual([]);
    // The live move that the list already had: nothing to do.
    expect(m.move(pose(2, 3), { ...pose(3, 3), w: 2, h: 1 })).toBe(false);
    expect(m.setAll([view({ x: 4 })])).toEqual([
      { from: { ...pose(3, 3), w: 2, h: 1 }, to: { ...pose(4, 3), w: 2, h: 1 } },
    ]);
    expect(m.setAll([])).toEqual([{ from: { ...pose(4, 3), w: 2, h: 1 }, to: pose(2, 3) }]);
    expect(m.size).toBe(0);
    expect(m.keepsMapPlace('base:sofa', 2, 3, 0)).toBe(true);
  });

  it('a move over a chunk edge touches both chunks, also those of the carried things', () => {
    expect(movedChunks(moved({ fromX: 31, x: 32 }))).toEqual(['0,0', '1,0']);
    expect(movedChunks(moved())).toEqual(['0,0']);
    expect(
      movedChunks(
        moved({ carried: [{ fromId: objectId(3, 3, 0, 1), toId: objectId(3, 32, 0, 1) }] }),
      ),
    ).toEqual(['0,0', '0,1']);
  });

  it('pose before a turn: rot − 1, w × h swapped', () => {
    expect(poseBefore(moved({ x: 2, cause: 'rotate', rot: 0, w: 1, h: 2 }))).toEqual({
      ...pose(2, 3, 3),
      w: 2,
      h: 1,
    });
    expect(poseBefore(moved())).toEqual({ ...pose(2, 3), w: 2, h: 1 });
  });

  it('carried things: same shift; a turn goes clockwise about the NW tile (sim #286)', () => {
    const piece = { tx: 10, ty: 5, w: 2, h: 1 };
    const tv = { contentId: 'base:tv', tx: 11, ty: 5, z: 0, rot: 0 };
    expect(carriedPose(piece, tv, { dx: 0, dy: 1 })).toMatchObject({ tx: 11, ty: 6, rot: 0 });
    // Local (1, 0) of a 2 × 1 piece → (h − 1 − 0, 1) = (0, 1).
    expect(carriedPose(piece, tv, 'rotate')).toMatchObject({ tx: 10, ty: 6, rot: 1 });
  });

  it('turns the short way (3 → 0 is 90°)', () => {
    expect(turnTo(-1.5 * Math.PI, 0, 1)).toBeCloseTo(-2 * Math.PI);
    expect(turnTo(0, -Math.PI / 2, 0.5)).toBeCloseTo(-Math.PI / 4);
  });
});

const CATALOG = {
  containers: {},
  items: {
    'base:sofa': { placeable: { footprint: { w: 2, h: 1 } } },
    'base:tv-stand': { placeable: { footprint: { w: 2, h: 1 }, surfaceHeightM: 0.55 } },
    'base:tv': { placeable: { onSurface: true } },
    'base:vcr': { placeable: { onSurface: true } },
  },
};
const chunk = (cx = 0): ChunkData => ({
  coord: { cx, cy: 0, z: 0 },
  floor: new Uint16Array(CHUNK_TILES).fill(1),
  objects:
    cx === 0
      ? [
          { contentId: 'base:sofa', x: 2, y: 3, rot: 0 },
          { contentId: 'base:dresser', x: 8, y: 8, rot: 0 },
          { contentId: 'base:tv-stand', x: 10, y: 5, rot: 0 },
          { contentId: 'base:vcr', x: 11, y: 5, rot: 0 },
          { contentId: 'base:tv', x: 11, y: 5, rot: 0 },
        ]
      : [],
});
const sofa = (m: MapObjects) => m.objectAt(3, 3, 0) ?? m.objectAt(4, 3, 0);
const stand = (p: Partial<FurnitureMovedEvent>) =>
  moved({
    contentId: 'base:tv-stand',
    fromX: 10,
    fromY: 5,
    fromId: objectId(10, 5, 0, 0),
    x: 10,
    y: 6,
    toId: objectId(10, 6, 0, 0),
    carried: [
      { fromId: objectId(11, 5, 0, 0), toId: objectId(11, 6, 0, 0) },
      { fromId: objectId(11, 5, 0, 1), toId: objectId(11, 6, 0, 1) },
    ],
    ...p,
  });

describe('MapObjects.moveFurniture', () => {
  const setup = () => {
    const m = new MapObjects();
    m.setFootprints({ ...footprintsOn(CATALOG), ...surfacesOf(CATALOG) });
    m.loadChunk(chunk(0));
    m.loadChunk(chunk(1));
    return m;
  };

  it('the same model slides to the new tiles, then sits there; a chunk rebuild keeps it', () => {
    const m = setup();
    const n = m.count;
    m.moveFurniture(moved());
    expect(m.count).toBe(n);
    expect(m.objectAt(2, 3, 0)).toBeUndefined();
    expect(sofa(m)).toMatchObject({ contentId: 'base:sofa', tx: 3, ty: 3, rot: 0 });
    expect(m.movingCount).toBe(1);
    m.update([], 1000);
    const x0 = m.drawnAt(3, 3, 0)!.x;
    m.update([], 1000 + FURNITURE_TWEEN_MS / 2);
    const mid = m.drawnAt(3, 3, 0)!.x;
    expect(mid).toBeGreaterThan(x0);
    expect(mid).toBeLessThan(x0 + 1);
    m.update([], 1000 + FURNITURE_TWEEN_MS);
    expect(m.movingCount).toBe(0);
    expect(m.drawnAt(3, 3, 0)!.x).toBeCloseTo(x0 + 1);
    m.loadChunk(chunk(0));
    expect(m.count).toBe(n);
    expect(m.objectAt(2, 3, 0)).toBeUndefined();
    expect(sofa(m)).toMatchObject({ tx: 3, ty: 3 });
  });

  it('(a) carried: TV and VCR ride along with the TV stand in the same slide', () => {
    const m = setup();
    m.moveFurniture(stand({}));
    expect(m.movingCount).toBe(3);
    expect(m.objectAt(11, 5, 0)).toBeUndefined();
    m.update([], 0);
    const a = m.drawnAt(10, 6, 0)!;
    const b = m.drawnAt(11, 6, 0)!;
    m.update([], FURNITURE_TWEEN_MS / 2);
    const a2 = m.drawnAt(10, 6, 0)!;
    const b2 = m.drawnAt(11, 6, 0)!;
    expect(a2.z - a.z).toBeCloseTo(b2.z - b.z);
    expect(a2.z - a.z).not.toBeCloseTo(0);
    m.update([], FURNITURE_TWEEN_MS);
    m.loadChunk(chunk(0));
    // Stand + 2 things on its top on the new tiles; nothing left behind.
    expect(m.objectAt(11, 5, 0)).toBeUndefined();
    expect(m.movingCount).toBe(0);
  });

  it('(a) carried turn: things go round the NW tile with rot + 1', () => {
    const m = setup();
    m.moveFurniture(
      stand({
        cause: 'rotate',
        x: 10,
        y: 5,
        toId: objectId(10, 5, 0, 0),
        rot: 1,
        w: 1,
        h: 2,
        carried: [
          { fromId: objectId(11, 5, 0, 0), toId: objectId(10, 6, 0, 0) },
          { fromId: objectId(11, 5, 0, 1), toId: objectId(10, 6, 0, 1) },
        ],
      }),
    );
    expect(m.objectAt(10, 6, 0)).toBeDefined();
    expect(m.objectAt(11, 5, 0)).toBeUndefined();
  });

  it('(b) action preview: the piece and its top go along dir with the action progress', () => {
    const m = setup();
    const id = objectId(10, 5, 0, 0);
    m.update([], 0);
    const z0 = m.drawnAt(10, 5, 0)!.z;
    const tv0 = m.drawnAt(11, 5, 0)!.z;
    m.previewFurnitureMove({ furnitureId: id, mode: 'push', dirX: 0, dirY: 1 }, 0.5);
    m.update([], 16);
    expect(m.movingCount).toBe(3);
    const half = m.drawnAt(10, 5, 0)!.z - z0;
    expect(Math.abs(half)).toBeCloseTo(0.5);
    expect(m.drawnAt(11, 5, 0)!.z - tv0).toBeCloseTo(half);
    m.previewFurnitureMove({ furnitureId: id, mode: 'push', dirX: 0, dirY: 1 }, 1);
    m.update([], 32);
    // The move lands: from where the preview has it, onto the place, no step back.
    m.moveFurniture(stand({}));
    m.update([], 48);
    expect(Math.abs(m.drawnAt(10, 6, 0)!.z - z0)).toBeCloseTo(1, 1);
    m.previewFurnitureMove(undefined, 0);
    m.update([], 1000);
    expect(m.movingCount).toBe(0);
    expect(Math.abs(m.drawnAt(10, 6, 0)!.z - z0)).toBeCloseTo(1);
  });

  it('(b) interrupted preview settles back; rotate turns the piece', () => {
    const m = setup();
    const id = objectId(10, 5, 0, 0);
    m.update([], 0);
    const p0 = m.drawnAt(10, 5, 0)!;
    m.previewFurnitureMove({ furnitureId: id, mode: 'rotate', dirX: 0, dirY: 0 }, 0.5);
    m.update([], 16);
    expect(m.drawnAt(10, 5, 0)!.distanceTo(p0)).toBeGreaterThan(0.1);
    m.previewFurnitureMove(undefined, 0);
    m.update([], 100);
    m.update([], 1000);
    expect(m.movingCount).toBe(0);
    expect(m.drawnAt(10, 5, 0)!.distanceTo(p0)).toBeCloseTo(0);
  });

  it('(c) list after a load: on the place at once (no slide), same list twice = no-op', () => {
    const m = new MapObjects();
    m.setFootprints({ ...footprintsOn(CATALOG), ...surfacesOf(CATALOG) });
    const list = [
      view(),
      view({ contentId: 'base:tv', fromX: 11, fromY: 5, x: 11, y: 7, w: 1, h: 1 }),
    ];
    // First view before the chunks (load): they come in already moved.
    m.setFurnitureMoves(list);
    m.loadChunk(chunk(0));
    expect(m.objectAt(2, 3, 0)).toBeUndefined();
    expect(sofa(m)).toMatchObject({ tx: 3 });
    expect(m.objectAt(11, 7, 0)).toMatchObject({ contentId: 'base:tv' });
    const n = m.count;
    m.setFurnitureMoves(list);
    expect(m.count).toBe(n);
    expect(m.movingCount).toBe(0);
    // A later list with chunks loaded: snap, no slide; empty = all back on the map places.
    m.setFurnitureMoves([view({ x: 5 })]);
    expect(m.movingCount).toBe(0);
    expect(m.objectAt(5, 3, 0)).toMatchObject({ tx: 5 });
    // The TV is not in the list any more: back on the stand (11, 5).
    expect(m.objectAt(11, 7, 0)).toBeUndefined();
    expect(m.count).toBe(n);
    m.setFurnitureMoves([]);
    expect(m.objectAt(2, 3, 0)).toMatchObject({ tx: 2 });
    expect(m.count).toBe(n);
  });

  it('into the next chunk: owned by it (unloads with it, comes back with it)', () => {
    const m = setup();
    const n = m.count;
    m.moveFurniture(moved({ fromX: 2, x: 32 }));
    expect(m.objectAt(32, 3, 0)).toMatchObject({ tx: 32 });
    m.unloadChunk(1, 0, 0);
    expect(m.count).toBe(n - 1);
    m.loadChunk(chunk(0));
    expect(m.count).toBe(n - 1);
    m.loadChunk(chunk(1));
    expect(m.count).toBe(n);
    expect(m.objectAt(33, 3, 0)).toMatchObject({ tx: 32 });
  });
});
