import { describe, expect, it } from 'vitest';
import {
  FootprintSchema,
  footprintCenter,
  footprintForId,
  footprintOf,
  occupiedTiles,
  rotatedFootprint,
} from '../footprint/index.js';

const xy = (t: { x: number; y: number }[]) => t.map((p) => `${p.x},${p.y}`);

describe('FootprintSchema', () => {
  it('liczby całkowite 1–4', () => {
    expect(FootprintSchema.safeParse({ w: 1, h: 1 }).success).toBe(true);
    expect(FootprintSchema.safeParse({ w: 4, h: 4 }).success).toBe(true);
    for (const bad of [
      { w: 0, h: 1 },
      { w: 5, h: 1 },
      { w: 1.5, h: 1 },
      { w: 2 },
      { w: 1, h: 1, d: 1 },
    ])
      expect(FootprintSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe('footprintOf', () => {
  it('brak definicji lub pola = 1×1', () => {
    expect(footprintOf(undefined)).toEqual({ w: 1, h: 1 });
    expect(footprintOf({})).toEqual({ w: 1, h: 1 });
    expect(footprintOf({ placeable: {} })).toEqual({ w: 1, h: 1 });
  });
  it('typ schowka i przedmiot placeable', () => {
    expect(footprintOf({ footprint: { w: 2, h: 1 } })).toEqual({ w: 2, h: 1 });
    expect(footprintOf({ placeable: { footprint: { w: 1, h: 2 } } })).toEqual({ w: 1, h: 2 });
  });
  it('footprintForId: schowek przed przedmiotem, nieznane = 1×1', () => {
    const cat = {
      containers: { 'a:desk': { footprint: { w: 2, h: 1 } } },
      items: { 'a:bed': { placeable: { footprint: { w: 1, h: 2 } } } },
    };
    expect(footprintForId(cat, 'a:desk')).toEqual({ w: 2, h: 1 });
    expect(footprintForId(cat, 'a:bed')).toEqual({ w: 1, h: 2 });
    expect(footprintForId(cat, 'a:none')).toEqual({ w: 1, h: 1 });
  });
});

describe('occupiedTiles: kotwica = kafel NW, obrót zamienia boki przy rot 1 i 3', () => {
  const wide = { w: 2, h: 1 };
  it.each([
    [0, ['5,7', '6,7']],
    [1, ['5,7', '5,8']],
    [2, ['5,7', '6,7']],
    [3, ['5,7', '5,8']],
  ])('2×1, rot %i', (rot, tiles) => {
    expect(xy(occupiedTiles(5, 7, rot, wide))).toEqual(tiles);
  });

  it.each([
    [0, ['0,0', '0,1']],
    [1, ['0,0', '1,0']],
    [2, ['0,0', '0,1']],
    [3, ['0,0', '1,0']],
  ])('łóżko 1×2, rot %i', (rot, tiles) => {
    expect(xy(occupiedTiles(0, 0, rot, { w: 1, h: 2 }))).toEqual(tiles);
  });

  it.each([0, 1, 2, 3])('3×2, rot %i: w·h kafli, bez powtórzeń, wszystkie ≥ kotwicy', (rot) => {
    const t = occupiedTiles(10, 20, rot, { w: 3, h: 2 });
    expect(t).toHaveLength(6);
    expect(new Set(xy(t)).size).toBe(6);
    expect(t.every((p) => p.x >= 10 && p.y >= 20)).toBe(true);
    const r = rotatedFootprint(rot, { w: 3, h: 2 });
    expect(Math.max(...t.map((p) => p.x)) - 10 + 1).toBe(r.w);
    expect(Math.max(...t.map((p) => p.y)) - 20 + 1).toBe(r.h);
  });

  it('1×1 to tylko kafel kotwicy (stare mapy bez zmian)', () => {
    for (const rot of [0, 1, 2, 3])
      expect(xy(occupiedTiles(3, 4, rot, { w: 1, h: 1 }))).toEqual(['3,4']);
  });
});

describe('footprintCenter', () => {
  it('1×1 = środek kafla jak dotąd; 2×1 obrócony stoi w pionie', () => {
    expect(footprintCenter(3, 4, 2, { w: 1, h: 1 })).toEqual({ x: 3.5, y: 4.5 });
    expect(footprintCenter(3, 4, 0, { w: 2, h: 1 })).toEqual({ x: 4, y: 4.5 });
    expect(footprintCenter(3, 4, 1, { w: 2, h: 1 })).toEqual({ x: 3.5, y: 5 });
    expect(footprintCenter(3, 4, 3, { w: 2, h: 2 })).toEqual({ x: 4, y: 5 });
  });
});
