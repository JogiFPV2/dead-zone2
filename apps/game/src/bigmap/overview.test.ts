import { describe, expect, it } from 'vitest';
import { CELLS, chunkCells, fogMaskAlpha, halve, levelFor } from './overview.js';
import { PAPER } from './paper.js';
import { fogGrid, setDiscovered } from './bigmap-model.js';

const KINDS = Object.keys(PAPER);
const palette = [null, 'base:grass', 'base:asphalt', 'base:concrete', 'base:water'];

describe('overview atlas', () => {
  it('chunk → 8 × 8 paper cells: grass, road, buildings, water', () => {
    const floor = new Uint16Array(1024).fill(1);
    const room = new Uint16Array(1024);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const i = y * 32 + x;
        if (x >= 12 && x < 14) floor[i] = 2; // 2 m road at cell column 3
        if (x >= 24 && y < 8) {
          room[i] = 1; // building: cells (6..7, 0..1)
          floor[i] = 3;
        }
        if (y >= 28) floor[i] = 4; // water: last cell row
      }
    }
    const cells = chunkCells({ floor, room }, palette);
    expect(cells.length).toBe(CELLS * CELLS);
    const at = (cx: number, cy: number) => KINDS[cells[cy * CELLS + cx]!];
    expect(at(0, 0)).toBe('field');
    expect(at(3, 2)).toBe('road');
    expect(at(6, 0)).toBe('building');
    expect(at(7, 1)).toBe('building');
    expect(at(0, 7)).toBe('water');
  });

  it('mip levels halve the block (box filter)', () => {
    const src = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) src.set([i < 8 ? 0 : 200, 100, 50, 255], i * 4);
    const h = halve(src, 4);
    expect(h.length).toBe(2 * 2 * 4);
    expect([...h.subarray(0, 4)]).toEqual([0, 100, 50, 255]);
    expect([...h.subarray(8, 12)]).toEqual([200, 100, 50, 255]);
  });

  it('level by screen scale: 4 m / px close, 16 m / px for the whole map', () => {
    expect(levelFor(0.3467 * 0.5)).toBe(0);
    expect(levelFor(0.3467 * 0.3)).toBe(1);
    expect(levelFor(0.3467 * 0.1)).toBe(2);
  });

  it('fog mask: transparent where discovered', () => {
    const g = fogGrid({ cx0: 0, cy0: 0, cx1: 3, cy1: 3 });
    setDiscovered(g, 1, 2);
    const rgba = new Uint8ClampedArray(16 * 4);
    fogMaskAlpha(g, rgba);
    expect(rgba[(2 * 4 + 1) * 4 + 3]).toBe(0);
    expect(rgba[3]).toBe(255);
  });
});
