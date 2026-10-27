import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { BLD_PALETTE } from './bld-palette.js';
import {
  BLD_V2_DEFAULT,
  ESTATE_CELL,
  V2_CELLS,
  V2_ROOF_HEX,
  V2_SKINS,
  V2_WALL_COUNT,
  V2_WALL_HEX,
  bldType,
  clearBuildings,
  initBldV2,
  noteBuildings,
  setBldV2,
  subCellUv,
  v2RoofCell,
  v2WallSkin,
  weighted,
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
      expect(p.walls).toEqual(src[t]!.walls);
      expect(p.roofs).toEqual(src[t]!.roofs);
      expect(p.weights).toEqual(src[t]!.weights);
    }
  });
  it('one skin per unique wall colour', () => {
    expect(V2_WALL_HEX).toHaveLength(V2_WALL_COUNT);
    expect(V2_SKINS).toHaveLength(V2_WALL_COUNT);
  });
  it('kinds map to types', () => {
    expect(bldType('block')).toBe('block');
    expect(bldType('shop')).toBe('service');
    expect(bldType('church')).toBe('public');
    expect(bldType('garage')).toBe('outbuilding');
    expect(bldType('ruin')).toBeUndefined();
  });
  it('weighted pick follows the weights', () => {
    expect(weighted([0.25, 0.75], 0.1)).toBe(0);
    expect(weighted([0.25, 0.75], 0.3)).toBe(1);
    expect(weighted([0.25, 0.75], 0.9999)).toBe(1);
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
    expect(V2_CELLS).toHaveLength(V2_WALL_COUNT * 2 + V2_ROOF_HEX.length);
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
  it('default look unchanged when off', () => {
    noteBuildings([house(5)]);
    expect(skinOfWall('base:plaster-wall', 5)).toBe('plaster');
    expect(roofColour(5)).toBe('roof-b');
  });
  it('v2: house colours from the house palette, stable by id', () => {
    setBldV2(true);
    noteBuildings([house(5)]);
    const s = skinOfWall('base:plaster-wall', 5);
    expect(s).toBe(v2WallSkin(5));
    expect(BLD_PALETTE.house.walls).toContain(V2_WALL_HEX[V2_SKINS.indexOf(s as never)]);
    expect(WALL_CELL[s]).toBe(`${s}-wall`);
    const roof = roofColour(5, 'base:roof-flat');
    expect(BLD_PALETTE.house.roofs).toContain(V2_ROOF_HEX[Number(roof.slice(3))]);
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
