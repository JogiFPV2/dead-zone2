import { BoxGeometry, Mesh, Group } from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_TILES, type ChunkData } from './chunk.js';
import {
  FOOTPRINTS_OFF,
  footprintsOn,
  furnitureFootprintsFromFiles,
  surfaceLift,
  surfaceSpread,
  surfacesOf,
  type FurnitureFootprints,
} from './furniture-footprint.js';
import { MapObjects } from './map-objects.js';

const catalog = {
  containers: {
    'base:tv-stand': { surfaceHeightM: 0.55 },
    'base:desk': { footprint: { w: 2, h: 1 }, surfaceHeightM: 0.75 },
    'base:dresser': {},
  },
  items: {
    'base:vcr': { placeable: { onSurface: true } },
    'base:tv': { placeable: { onSurface: true } },
    'base:radio-set': { placeable: { onSurface: true } },
    'base:desk-lamp': { placeable: { onSurface: true } },
    'base:table': { placeable: { footprint: { w: 2, h: 1 }, surfaceHeightM: 0.75 } },
  },
};
const on: FurnitureFootprints = {
  ...footprintsOn(catalog),
  ...surfacesOf(catalog),
};
const obj = (contentId: string, tx: number, ty: number, rot = 0) => ({
  contentId,
  tx,
  ty,
  z: 0,
  rot,
});

describe('surfaceLift (onSurface furniture on the piece below)', () => {
  it('lifts a VCR on a TV stand to 0.55 m and a radio / lamp on a desk or table to 0.75 m', () => {
    const stand = obj('base:tv-stand', 1, 1);
    const vcr = obj('base:vcr', 1, 1);
    const desk = obj('base:desk', 4, 1);
    const radio = obj('base:radio-set', 5, 1); // second tile of the 2×1 desk
    const table = obj('base:table', 8, 1);
    const lamp = obj('base:desk-lamp', 8, 1);
    const all = [vcr, stand, desk, radio, table, lamp];
    const none = () => undefined;
    expect(surfaceLift(all, on, vcr, none)).toBe(0.55);
    expect(surfaceLift(all, on, radio, none)).toBe(0.75);
    expect(surfaceLift(all, on, lamp, none)).toBe(0.75);
    expect(surfaceLift(all, on, stand, none)).toBe(0);
    expect(surfaceLift(all, on, desk, none)).toBe(0);
  });

  it('keeps an onSurface piece on the floor with nothing below, falls back to the model top', () => {
    const vcr = obj('base:vcr', 1, 1);
    expect(surfaceLift([vcr], on, vcr, () => 9)).toBe(0);
    const dresser = obj('base:dresser', 2, 2);
    const lamp = obj('base:desk-lamp', 2, 2);
    expect(surfaceLift([dresser, lamp], on, lamp, () => 0.8)).toBe(0.8);
    // Footprints off: only the anchor tile counts, surfaces still apply.
    const off = { ...FOOTPRINTS_OFF, ...surfacesOf(catalog) };
    const desk = obj('base:desk', 4, 1);
    expect(
      surfaceLift([desk, obj('base:radio-set', 5, 1)], off, obj('base:radio-set', 5, 1), () => 1),
    ).toBe(0);
    const r = obj('base:radio-set', 4, 1);
    expect(surfaceLift([desk, r], off, r, () => 1)).toBe(0.75);
  });

  it('reads surfaceHeightM / onSurface from the base pack files', () => {
    const f = furnitureFootprintsFromFiles([
      { path: 'containers/home.json', json: [{ id: 'base:tv-stand', surfaceHeightM: 0.55 }] },
      { path: 'items/x.json', json: [{ id: 'base:vcr', placeable: { onSurface: true } }] },
    ]);
    expect(f.surfaceOf?.('base:tv-stand')).toBe(0.55);
    expect(f.onSurface?.('base:vcr')).toBe(true);
    expect(f.onSurface?.('base:tv-stand')).toBe(false);
  });
});

describe('MapObjects lifts stacked furniture', () => {
  const chunk = (): ChunkData => ({
    coord: { cx: 0, cy: 0, z: 0 },
    floor: new Uint16Array(CHUNK_TILES).fill(1),
    objects: [
      { contentId: 'base:vcr', x: 1, y: 1, rot: 0 },
      { contentId: 'base:tv-stand', x: 1, y: 1, rot: 0 },
      { contentId: 'base:dresser', x: 3, y: 1, rot: 0 },
      { contentId: 'base:desk-lamp', x: 3, y: 1, rot: 0 },
    ],
  });
  it('puts the VCR on the stand (content) and the lamp on the dresser (model top)', () => {
    const m = new MapObjects();
    m.setFootprints(on);
    m.loadChunk(chunk());
    const objs = (m as unknown as { objects: { contentId: string; lift: number }[] }).objects;
    const lift = (id: string) => objs.find((o) => o.contentId === id)!.lift;
    expect(lift('base:vcr')).toBe(0.55);
    expect(lift('base:tv-stand')).toBe(0);
    // No model yet: the dresser's grey box height.
    expect(lift('base:desk-lamp')).toBeGreaterThan(0);
    m.applyModels((id) => {
      if (id !== 'base:dresser') return undefined;
      const g = new Group();
      g.add(new Mesh(new BoxGeometry(0.8, 0.9, 0.5).translate(0, 0.45, 0)));
      return g;
    });
    expect(lift('base:desk-lamp')).toBeCloseTo(0.9, 2);
  });

  it('a desk lamp on a desk stands at the desk top once (no extra fixed lift)', () => {
    const m = new MapObjects();
    m.setFootprints(on);
    m.loadChunk({
      coord: { cx: 0, cy: 0, z: 0 },
      floor: new Uint16Array(CHUNK_TILES).fill(1),
      objects: [
        { contentId: 'base:desk', x: 4, y: 1, rot: 0 },
        { contentId: 'base:desk-lamp', x: 5, y: 1, rot: 0 },
        { contentId: 'base:desk-lamp', x: 9, y: 9, rot: 0 },
      ],
    });
    const objs = (
      m as unknown as { objects: { tx: number; lift: number; mesh: Mesh; height: number }[] }
    ).objects;
    const base = (tx: number) => {
      const o = objs.find((x) => x.tx === tx)!;
      return o.mesh.position.y - o.height / 2;
    };
    expect(base(5)).toBeCloseTo(0.75, 5);
    expect(base(9)).toBeCloseTo(0.75, 5); // no desk: today's fixed lift
  });
});

describe('surfaceSpread (several pieces on one worktop tile, #282)', () => {
  it('spreads the VCR and TV on a TV stand apart along the wall, in map order', () => {
    const stand = obj('base:tv-stand', 1, 1);
    const vcr = obj('base:vcr', 1, 1);
    const tv = obj('base:tv', 1, 1);
    const all = [stand, vcr, tv];
    expect(surfaceSpread(all, on, vcr)).toBeCloseTo(-0.225, 5);
    expect(surfaceSpread(all, on, tv)).toBeCloseTo(0.225, 5);
    expect(surfaceSpread(all, on, stand)).toBe(0);
    // Three on one tile: evenly about the centre, still within the tile.
    const radio = obj('base:radio-set', 1, 1);
    const three = [...all, radio];
    const xs = [vcr, tv, radio].map((o) => surfaceSpread(three, on, o));
    expect(xs[0]).toBeCloseTo(-1 / 3, 5);
    expect(xs[1]).toBeCloseTo(0, 5);
    expect(xs[2]).toBeCloseTo(1 / 3, 5);
  });

  it('stands on the TV stand, not on a light switch sharing its tile (listed first)', () => {
    const sw = obj('base:light-switch', 1, 1);
    const stand = obj('base:tv-stand', 1, 1);
    const vcr = obj('base:vcr', 1, 1);
    const tv = obj('base:tv', 1, 1);
    const all = [sw, vcr, tv, stand];
    expect(surfaceLift(all, on, vcr, () => 0.12)).toBe(0.55);
    expect(surfaceLift([sw, vcr], on, vcr, () => 0.12)).toBe(0);
    expect(surfaceSpread(all, on, tv)).toBeCloseTo(0.225, 5);
  });

  it('leaves a lone piece, or pieces with nothing below, at the tile centre', () => {
    const desk = obj('base:desk', 4, 1);
    const lamp = obj('base:desk-lamp', 4, 1);
    expect(surfaceSpread([desk, lamp], on, lamp)).toBe(0);
    const a = obj('base:vcr', 7, 7);
    const b = obj('base:tv', 7, 7);
    expect(surfaceSpread([a, b], on, a)).toBe(0);
  });

  it('MapObjects draws the VCR and TV on the stand side by side, both at its top', () => {
    const m = new MapObjects();
    m.setFootprints(on);
    m.loadChunk({
      coord: { cx: 0, cy: 0, z: 0 },
      floor: new Uint16Array(CHUNK_TILES).fill(1),
      objects: [
        { contentId: 'base:tv-stand', x: 1, y: 1, rot: 0 },
        { contentId: 'base:vcr', x: 1, y: 1, rot: 0 },
        { contentId: 'base:tv', x: 1, y: 1, rot: 0 },
      ],
    });
    const objs = (m as unknown as { objects: { contentId: string; lift: number; mesh: Mesh }[] })
      .objects;
    const at = (id: string) => objs.find((o) => o.contentId === id)!;
    expect(at('base:vcr').lift).toBe(0.55);
    expect(at('base:tv').lift).toBe(0.55);
    const dx = at('base:tv').mesh.position.x - at('base:vcr').mesh.position.x;
    const dz = at('base:tv').mesh.position.z - at('base:vcr').mesh.position.z;
    expect(Math.hypot(dx, dz)).toBeCloseTo(0.45, 5);
  });
});
