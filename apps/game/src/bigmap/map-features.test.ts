import { describe, expect, it } from 'vitest';
import {
  boundaryBounds,
  boundarySizeText,
  boundaryTagCorner,
  insideBoundary,
  layoutPlaces,
  placeTier,
  rectBoundary,
  rotatedSquare,
} from './map-features.js';

const vp = { width: 1280, height: 720 };

describe('map boundary', () => {
  it('rectangle of the chunk bounds, 16,4 × 16,4 km', () => {
    const b = rectBoundary({ x0: 0, y0: 0, x1: 16384, y1: 16384 });
    expect(boundarySizeText(b)).toBe('16,4 × 16,4 km');
    expect(boundaryTagCorner(b)).toEqual({ x: 0, y: 16384 });
    expect(insideBoundary(b, 10, 10)).toBe(true);
    expect(insideBoundary(b, -1, 10)).toBe(false);
  });

  it('the 16 km OSM square rotated 27° fits the 22 528 m world', () => {
    const sq = rotatedSquare(11264, 11264, 16384, 27);
    expect(boundarySizeText(sq)).toBe('16,4 × 16,4 km');
    const bb = boundaryBounds(sq);
    // 16 384 · (cos 27° + sin 27°) ≈ 22 036 m, centred.
    expect(bb.x1 - bb.x0).toBeCloseTo(22036, -1);
    expect(bb.x0).toBeGreaterThan(0);
    expect(bb.x1).toBeLessThan(22528);
    expect(insideBoundary(sq, 11264, 11264)).toBe(true);
    expect(insideBoundary(sq, 300, 300)).toBe(false);
  });
});

describe('place names', () => {
  it('tiers from OSM / content kinds', () => {
    expect(placeTier('town')).toBe('town');
    expect(placeTier('city')).toBe('town');
    expect(placeTier('village')).toBe('village');
    expect(placeTier(undefined)).toBe('village');
    expect(placeTier('suburb')).toBe('district');
    expect(placeTier('district')).toBe('district');
    expect(placeTier('hamlet')).toBe('hamlet');
    expect(placeTier('locality')).toBeUndefined();
  });

  const places = [
    { name: 'Pysznica', kind: 'village', x: 3000, y: 0 },
    { name: 'Stalowa Wola', kind: 'town', x: 0, y: 0 },
    { name: 'Rozwadów', kind: 'suburb', x: 0, y: 1200 },
    { name: 'Ziarny', kind: 'hamlet', x: 0, y: 2000 },
  ];
  const toScreen = (k: number) => (x: number, y: number) => ({ x: 640 + x * k, y: 360 + y * k });
  const measure = (t: string) => t.length * 8;

  it('towns and villages at every zoom (also below 0,5×), districts / hamlets closer', () => {
    const far = layoutPlaces(places, 0.1, toScreen(0.035), measure, vp);
    expect(far.map((l) => l.place.name)).toEqual(['Stalowa Wola', 'Pysznica']);
    expect(far[0]!.text).toBe('STALOWA WOLA');
    const mid = layoutPlaces(places, 0.5, toScreen(0.17), measure, vp);
    expect(mid.map((l) => l.place.name).sort()).toEqual(
      ['Pysznica', 'Rozwadów', 'Stalowa Wola', 'Ziarny'].sort(),
    );
  });

  it('drops a label overlapping a more important one, and those off screen', () => {
    const crowded = [
      { name: 'Wieś', kind: 'village', x: 10, y: 0 },
      { name: 'Miasto', kind: 'town', x: 0, y: 0 },
      { name: 'Daleko', kind: 'village', x: 1e6, y: 0 },
    ];
    const out = layoutPlaces(crowded, 1, toScreen(0.35), measure, vp);
    expect(out.map((l) => l.place.name)).toEqual(['Miasto']);
  });
});
