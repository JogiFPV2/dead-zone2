import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withExtCells } from '../../world/town/skins.js';
import type { TownKitIndex } from '../../world/town/kit.js';
import { NO_LAYER, buildCellLut, kitCellLayer } from './kit-layers.js';
import { LAYER } from './layers.js';

describe('kitCellLayer', () => {
  it('maps palette cells to PBR layers', () => {
    expect(kitCellLayer('wall-brick')).toBe(LAYER.cegla);
    expect(kitCellLayer('wall-plaster-dark')).toBe(LAYER.tynk);
    expect(kitCellLayer('glass')).toBe(LAYER.szklo);
    expect(kitCellLayer('glass-lit')).toBe(NO_LAYER);
    expect(kitCellLayer('roof-gravel')).toBe(LAYER.papa);
    expect(kitCellLayer('door-wood')).toBe(LAYER.drewno);
    expect(kitCellLayer('grass-c')).toBe(LAYER.trawa);
    expect(kitCellLayer('sidewalk')).toBe(LAYER.plyty);
    expect(kitCellLayer('p:#605045')).toBe(LAYER.gladki);
  });

  it('LUT covers every cell of the shipped town atlas', () => {
    const index = withExtCells(
      JSON.parse(
        readFileSync(
          new URL('../../../public/models/deadzone-town/town.json', import.meta.url),
          'utf8',
        ),
      ) as TownKitIndex,
    );
    const lut = buildCellLut(index.cells, 16);
    const at = (name: string) => {
      const [u, v] = index.cells[name]!.uv;
      return lut[Math.floor(v * 16) * 16 + Math.floor(u * 16)];
    };
    expect(at('wall-brick')).toBe(LAYER.cegla);
    expect(at('glass')).toBe(LAYER.szklo);
    expect(at('glass-lit')).toBe(NO_LAYER);
  });
});
