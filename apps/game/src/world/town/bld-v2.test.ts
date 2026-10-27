import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BLD_V2_DEFAULT,
  V2_ATLAS_SLOTS,
  V2_CELLS,
  V2_ROOFS,
  V2_SKINS,
  V2_WALLS,
  bldHash,
  initBldV2,
  setBldV2,
  v2RoofCell,
  v2WallSkin,
} from './bld-v2.js';
import { EXT_BASE, EXT_CELLS, withExtCells } from './skins.js';
import { WALL_CELL, edgeModule, roofColour, skinOfWall } from './modules.js';

afterEach(() => setBldV2(BLD_V2_DEFAULT));

describe('bld v2 flag', () => {
  it('?bld=v2 / ?bld=v1 override the default', () => {
    expect(initBldV2('?bld=v2')).toBe(true);
    expect(initBldV2('?bld=v1')).toBe(false);
    expect(initBldV2('')).toBe(BLD_V2_DEFAULT);
  });
});

describe('palette', () => {
  it('placeholder sizes: 12 walls, 8 roofs', () => {
    expect(V2_WALLS).toHaveLength(12);
    expect(V2_ROOFS).toHaveLength(8);
  });
  it('cells fit free atlas slots, clear of the kit and catalogue cells', () => {
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
    const mine = V2_CELLS.map((c) => c[2]);
    expect(new Set(mine).size).toBe(mine.length);
    for (const i of mine) {
      expect(i).toBeLessThan(256);
      expect(used.has(i)).toBe(false);
      expect(V2_ATLAS_SLOTS).toContain(i);
    }
  });
  it('withExtCells adds every v2 cell', () => {
    const out = withExtCells({ cells: {} } as never);
    for (const [name] of V2_CELLS) expect(out.cells[name]).toBeDefined();
  });
});

describe('per-building colours', () => {
  it('stable by id and spread over the palette', () => {
    expect(v2WallSkin(42)).toBe(v2WallSkin(42));
    expect(bldHash(7, 1)).toBe(bldHash(7, 1));
    const walls = new Set(Array.from({ length: 300 }, (_, i) => v2WallSkin(i + 1)));
    const roofs = new Set(Array.from({ length: 300 }, (_, i) => v2RoofCell(i + 1)));
    expect(walls.size).toBe(V2_SKINS.length);
    expect(roofs.size).toBe(V2_ROOFS.length);
  });
  it('default look unchanged when off', () => {
    setBldV2(false);
    expect(skinOfWall('base:plaster-wall', 5)).toBe('plaster');
    expect(roofColour(5)).toBe('roof-b');
  });
  it('v2 recolours siding / plaster, keeps brick and catalogue skins', () => {
    setBldV2(true);
    const s = skinOfWall('base:plaster-wall', 5);
    expect(s).toBe(v2WallSkin(5));
    expect(WALL_CELL[s]).toBe(`${s}-wall`);
    expect(edgeModule('wall', s, 'base:plaster-wall', { lowered: false })).toBe(`wall-${s}`);
    expect(skinOfWall('base:brick-wall', 5)).toBe('brick');
    expect(skinOfWall('base:wall-hospital', 5)).toBe('hospital');
    expect(roofColour(5, 'base:roof-flat')).toBe(v2RoofCell(5));
    expect(roofColour(5, 'base:roof-corrugated')).toBe('corrugated');
  });
});
