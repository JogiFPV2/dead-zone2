import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { BLD_PALETTE } from './bld-palette.js';
import { LOOK_PALETTE } from '@deadzone/map/world-source';
import {
  BLD_V2_DEFAULT,
  ESTATE_CELL,
  V2_CELLS,
  V2_ROOF_HEX,
  V2_SKINS,
  V2_WALL_COUNT,
  V2_WALL_HEX,
  bldType,
  bldTypeOf,
  PUBLIC_MIN_AREA,
  clearBuildings,
  conditionTint,
  nearestHex,
  initBldV2,
  noteBuildings,
  setBldV2,
  subCellUv,
  v2RoofCell,
  v2WallSkin,
} from './bld-v2.js';
import { EXT_BASE, EXT_CELLS, remapCells, withExtCells } from './skins.js';
import { WALL_CELL, roofColour, skinOfWall } from './modules.js';
import { BufferAttribute, BufferGeometry } from 'three';

afterEach(() => {
  setBldV2(BLD_V2_DEFAULT);
  clearBuildings();
});

const house = (id: number, x = 0, y = 0) => ({
  id,
  kind: 'house',
  x0: x,
  y0: y,
  x1: x + 8,
  y1: y + 8,
});

describe('flag', () => {
  it('?bld=v2 / ?bld=v1 override the default', () => {
    expect(initBldV2('?bld=v2')).toBe(true);
    expect(initBldV2('?bld=v1')).toBe(false);
    expect(initBldV2('')).toBe(BLD_V2_DEFAULT);
  });
});

describe("Designer's palette", () => {
  it('matches look-palette.json', () => {
    const src = JSON.parse(
      readFileSync(
        new URL('../../../../../docs/design/look-palette.json', import.meta.url),
        'utf8',
      ),
    ) as Record<string, { walls: string[]; roofs: string[]; weights: number[] }>;
    for (const [t, p] of Object.entries(BLD_PALETTE)) {
      if (!src[t]) continue; // kamienica: from the spec table
      expect(p.walls).toEqual(src[t].walls);
      expect(p.roofs).toEqual(src[t].roofs);
      expect(p.weights).toEqual(src[t].weights);
    }
  });
  it('one skin per unique wall colour', () => {
    expect(V2_WALL_HEX).toHaveLength(V2_WALL_COUNT);
    // PKS / PKP stations keep their own sand / light grey walls in the atlas.
    for (const hex of ['#d6c48e', '#a9b4b8']) expect(V2_WALL_HEX).toContain(hex);
    expect(V2_SKINS).toHaveLength(V2_WALL_COUNT);
  });
  it('v2 is the default; atlas carries the generator palette', () => {
    expect(BLD_V2_DEFAULT).toBe(true);
    // Police white, barn red, the flat-roof membrane: nearest atlas colour within a small step.
    for (const [list, hex] of [
      [V2_WALL_HEX, LOOK_PALETTE.police.walls[0]!],
      [V2_WALL_HEX, LOOK_PALETTE.barn.walls[0]!],
      [V2_ROOF_HEX, '#b9b6ad'],
    ] as const) {
      const n = parseInt(hex.slice(1), 16);
      const m = parseInt(list[nearestHex(list, hex)]!.slice(1), 16);
      const d = [16, 8, 0].reduce((s, k) => s + (((n >> k) & 255) - ((m >> k) & 255)) ** 2, 0);
      expect(d).toBeLessThan(20 ** 2);
    }
  });
  it('condition darkens and greys the colour', () => {
    expect(conditionTint('#8e3b2c', 'ok')).toBe('#8e3b2c');
    const r = conditionTint('#8e3b2c', 'ruin');
    expect(parseInt(r.slice(1, 3), 16)).toBeLessThan(0x8e);
  });
  it('kinds map to types', () => {
    expect(bldType('block')).toBe('block');
    expect(bldType('shop')).toBe('service');
    expect(bldType('church')).toBe('public');
    expect(bldType('station')).toBe('station');
    expect(bldType('garage')).toBe('outbuilding');
    expect(bldType('ruin')).toBeUndefined();
  });
});

describe('atlas', () => {
  it('sub-cells are unique, inside free cells, clear of kit and catalogue cells', () => {
    const idx = JSON.parse(
      readFileSync(
        new URL('../../../public/models/deadzone-town/town.json', import.meta.url),
        'utf8',
      ),
    ) as { cells: Record<string, { uv: [number, number] }> };
    const used = new Set(
      Object.values(idx.cells).map((c) => Math.floor(c.uv[0] * 16) + 16 * Math.floor(c.uv[1] * 16)),
    );
    for (let k = 0; k < EXT_CELLS.length; k++) used.add(EXT_BASE + k);
    const keys = V2_CELLS.map(([, , s]) => `${s.cell}:${s.q}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(V2_CELLS).toHaveLength((V2_WALL_COUNT + V2_ROOF_HEX.length) * 2);
    for (const [, , s] of V2_CELLS) {
      expect(used.has(s.cell)).toBe(false);
      const [u, v] = subCellUv(s);
      expect(Math.floor(u * 16) + 16 * Math.floor(v * 16)).toBe(s.cell);
    }
  });
  it('withExtCells adds every v2 cell', () => {
    const out = withExtCells({ cells: {} } as never);
    for (const [name] of V2_CELLS) expect(out.cells[name]).toBeDefined();
  });
  it('remap into a sub-cell halves the in-cell offsets', () => {
    const g = new BufferGeometry();
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0.5 / 16 + 0.01, 0.5 / 16]), 2));
    const out = remapCells(g, [[[0.5 / 16, 0.5 / 16], [0.2, 0.2], 0.5]]);
    expect(out.getAttribute('uv').getX(0)).toBeCloseTo(0.205);
  });
});

describe('per-building look', () => {
  it('v1 look unchanged when off (?bld=v1)', () => {
    setBldV2(false);
    noteBuildings([house(5)]);
    expect(skinOfWall('base:plaster-wall', 5)).toBe('plaster');
    expect(roofColour(5)).toBe('roof-b');
  });
  it('v2: house colours from the house palette, stable by id', () => {
    setBldV2(true);
    noteBuildings([house(5)]);
    const s = skinOfWall('base:plaster-wall', 5);
    expect(s).toBe(v2WallSkin(5));
    expect(V2_WALL_HEX[V2_SKINS.indexOf(s as never)]).toBeDefined();
    expect(WALL_CELL[s]).toBe(`${s}-wall`);
    const roof = roofColour(5, 'base:roof-flat');
    expect(V2_CELLS.some(([n]) => n === `${roof}-dark`)).toBe(true);
    expect(skinOfWall('base:brick-wall', 5)).toBe('brick');
  });
  it('v2: unknown buildings and ruins keep the v1 look', () => {
    setBldV2(true);
    noteBuildings([{ id: 9, kind: 'ruin', x0: 0, y0: 0, x1: 1, y1: 1 }]);
    expect(skinOfWall('base:plaster-wall', 9)).toBe('plaster');
    expect(skinOfWall('base:plaster-wall', 10)).toBe('plaster');
    expect(roofColour(10, 'base:roof-tile')).toBe('roof-tile');
  });
  it('blocks share the wall colour per estate cell, houses vary', () => {
    setBldV2(true);
    const blocks = Array.from({ length: 6 }, (_, i) => ({
      id: 100 + i,
      kind: 'block',
      x0: 10 + i * 20,
      y0: 10,
      x1: 20 + i * 15,
      y1: 30,
    }));
    noteBuildings(blocks);
    expect(new Set(blocks.map((b) => v2WallSkin(b.id))).size).toBe(1);
    const far = {
      id: 200,
      kind: 'block',
      x0: ESTATE_CELL * 7,
      y0: 0,
      x1: ESTATE_CELL * 7 + 10,
      y1: 10,
    };
    noteBuildings([far]);
    expect(v2WallSkin(200)).toBeDefined();
    const houses = Array.from({ length: 80 }, (_, i) => house(1000 + i, i * 10, 0));
    noteBuildings(houses);
    expect(new Set(houses.map((h) => v2WallSkin(h.id))).size).toBeGreaterThan(3);
    expect(new Set(houses.map((h) => v2RoofCell(h.id))).size).toBeGreaterThan(2);
  });
});

describe('look from the chunk data (rev 21+)', () => {
  it('uses wallColor / roofColor from the data, nearest atlas colour', () => {
    setBldV2(true);
    const wall = BLD_PALETTE.kamienica.walls[1]!;
    const roof = BLD_PALETTE.house.roofs[2]!;
    noteBuildings([
      {
        id: 501,
        kind: 'house',
        x0: 0,
        y0: 0,
        x1: 9,
        y1: 9,
        look: 'house',
        wallColor: wall,
        roofColor: roof,
      },
    ]);
    expect(V2_WALL_HEX[V2_SKINS.indexOf(v2WallSkin(501)!)]).toBe(wall);
    expect(V2_ROOF_HEX[Number(v2RoofCell(501)!.slice(3))]).toBe(roof);
  });
});

describe('kamienica / publiczny', () => {
  const b = (kind: string, floors: number, side = 10) => ({
    id: 1,
    kind,
    x0: 0,
    y0: 0,
    x1: side,
    y1: side,
    floors,
  });
  it('tenements and 3+ floor houses are kamienice', () => {
    expect(bldTypeOf(b('tenement', 2))).toBe('kamienica');
    expect(bldTypeOf(b('house', 3))).toBe('kamienica');
    expect(bldTypeOf(b('house', 2))).toBe('house');
  });
  it('large 3+ floor offices are public, small ones service', () => {
    const big = Math.ceil(Math.sqrt(PUBLIC_MIN_AREA));
    expect(bldTypeOf(b('office', 3, big))).toBe('public');
    expect(bldTypeOf(b('office', 3, 10))).toBe('service');
    expect(bldTypeOf(b('office', 2, big))).toBe('service');
  });
  it('a kamienica gets a kamienica wall colour', () => {
    setBldV2(true);
    noteBuildings([{ ...b('tenement', 3), id: 77 }]);
    const s = v2WallSkin(77)!;
    expect(BLD_PALETTE.kamienica.walls).toContain(V2_WALL_HEX[V2_SKINS.indexOf(s)]);
  });
});
