import { describe, expect, it } from 'vitest';
import {
  BUSH_DENSITY,
  BUSH_MAX_PER_CHUNK,
  SHELL_INSET_M,
  SHELTER_SINGLE_SCALE,
  buildingPlacements,
  bushPlacements,
  shelterPlacements,
  type BuildingInfo,
} from './map-models.js';

const block = (o: Partial<BuildingInfo> = {}): BuildingInfo => ({
  id: 7,
  x0: 100,
  y0: 200,
  x1: 157,
  y1: 211,
  floors: 5,
  rect: true,
  kind: 'block',
  ...o,
});

describe('buildingPlacements', () => {
  it('a 58 × 12 m P+4 block → one blok-p4 centred on the footprint', () => {
    const p = buildingPlacements(block())!;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ id: 'blok-p4', x: 129, z: 206 });
    expect(p[0]!.sx).toBeCloseTo((58 - 2 * SHELL_INSET_M) / 57.6, 3);
    expect(p[0]!.sz).toBeCloseTo((12 - 2 * SHELL_INSET_M) / 12, 3);
    // 5 storeys of 3 m (kit) over the model's 5 × 3,3 m.
    expect(p[0]!.sy).toBeCloseTo(15 / 16.5, 3);
  });

  it('a long block repeats the model along its length (segments)', () => {
    const p = buildingPlacements(block({ x1: 100 + 115 }))!;
    expect(p.map((q) => q.id)).toEqual(['blok-p4', 'blok-p4']);
    expect(p[1]!.x - p[0]!.x).toBeCloseTo((116 - 2 * SHELL_INSET_M) / 2, 3);
    expect(p[0]!.z).toBe(p[1]!.z);
  });

  it('a block along y turns the model a quarter and lays segments along z', () => {
    const p = buildingPlacements(block({ x1: 112, y1: 200 + 57 }))!;
    expect(p).toHaveLength(1);
    expect(Math.abs(Math.cos(p[0]!.rotY))).toBeLessThan(1e-9);
    expect(p[0]!.x).toBe(106.5);
  });

  it('tall blocks get blok-p10, houses dom-90, kostki the hip-roof cube', () => {
    expect(buildingPlacements(block({ x1: 128, y1: 212, floors: 11 }))?.[0]?.id).toBe('blok-p10');
    expect(buildingPlacements(block({ kind: 'house', x1: 113, y1: 208, floors: 2 }))?.[0]?.id).toBe(
      'dom-90',
    );
    expect(
      buildingPlacements(block({ kind: 'kostka', x1: 109, y1: 209, floors: 2 }))?.[0]?.id,
    ).toBe('dom-kostka-namiot');
  });

  it('keeps the kit building when no model fits', () => {
    // Slanted / non-rectangular, unknown kind, storeys out of range, too squeezed.
    expect(buildingPlacements(block({ rect: false }))).toBeUndefined();
    expect(buildingPlacements(block({ outline: [0, 0, 1, 0, 1, 1] }))).toBeUndefined();
    expect(buildingPlacements(block({ kind: 'shop' }))).toBeUndefined();
    expect(buildingPlacements(block({ floors: 2 }))).toBeUndefined();
    expect(buildingPlacements(block({ x1: 115 }))).toBeUndefined();
    expect(buildingPlacements(block({ y1: 230 }))).toBeUndefined();
    expect(
      buildingPlacements(block({ kind: 'house', x1: 140, y1: 205, floors: 2 })),
    ).toBeUndefined();
  });

  it('is deterministic per building', () => {
    expect(buildingPlacements(block())).toEqual(buildingPlacements(block()));
  });
});

describe('shelterPlacements', () => {
  const d = (tx: number, ty: number, rot = 0) => ({ contentId: 'base:dumpster', tx, ty, rot });

  it('a pair of dumpsters → one full-size bin shelter along the pair', () => {
    const p = shelterPlacements([d(10, 5), d(11, 5), { ...d(3, 3), contentId: 'base:bench' }]);
    expect(p).toEqual([{ id: 'smietnik', x: 11, z: 5.5, rotY: 0, sx: 1, sy: 1, sz: 1 }]);
    const v = shelterPlacements([d(10, 5), d(10, 6)]);
    expect(v[0]).toMatchObject({ x: 10.5, z: 6, rotY: -Math.PI / 2 });
  });

  it('a lone dumpster → a smaller shelter turned like the object', () => {
    const p = shelterPlacements([d(4, 4, 1)]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ x: 4.5, z: 4.5, sx: SHELTER_SINGLE_SCALE });
    expect(p[0]!.rotY).toBeCloseTo(-Math.PI / 2 + Math.PI);
  });
});

describe('bushPlacements', () => {
  const rects = [{ x: 0, y: 0, w: 40, h: 30 }];

  it('scatters bushes inside the scrub rects, deterministically', () => {
    const a = bushPlacements(rects, 'medium');
    expect(a).toEqual(bushPlacements(rects, 'medium'));
    expect(a.length).toBeGreaterThan(40);
    for (const p of a) {
      expect(p.id).toBe('krzak');
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(40);
      expect(p.z).toBeLessThan(30);
    }
  });

  it('fewer on low, more on high, capped per chunk', () => {
    const n = (q: 'low' | 'medium' | 'high') => bushPlacements(rects, q).length;
    expect(n('low')).toBeLessThan(n('medium'));
    expect(n('medium')).toBeLessThan(n('high'));
    expect(BUSH_DENSITY.low).toBeLessThan(BUSH_DENSITY.high);
    expect(bushPlacements([{ x: 0, y: 0, w: 64, h: 64 }], 'high').length).toBe(BUSH_MAX_PER_CHUNK);
    expect(bushPlacements([], 'high')).toEqual([]);
  });
});
