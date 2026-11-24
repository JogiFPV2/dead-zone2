import { describe, expect, it } from 'vitest';
import { cutSegments } from './generator.js';

describe('cutSegments (okna w ukośnych ścianach, Fizyka 25.10)', () => {
  it('wycina fragment ściany w korytarzu okna', () => {
    const out = cutSegments([{ x0: 0, y0: 0.5, x1: 4, y1: 0.5, id: 1 }], [[1, 0, 2, 1]]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ x0: 0, x1: 1, id: 1 });
    expect(out[1]).toMatchObject({ x0: 2, x1: 4, id: 1 });
  });
  it('ukośna ściana sąsiada przecinająca korytarz też jest przecięta', () => {
    const out = cutSegments([{ x0: 0, y0: 0, x1: 3, y1: 3 }], [[1, 1, 2, 2]]);
    expect(out).toHaveLength(2);
    expect(out[0]!.x1).toBeCloseTo(1);
    expect(out[1]!.x0).toBeCloseTo(2);
  });
  it('ściana poza korytarzem zostaje nietknięta', () => {
    const w = [{ x0: 0, y0: 5, x1: 4, y1: 5 }];
    expect(cutSegments(w, [[1, 0, 2, 1]])).toEqual(w);
  });
  it('wycięty kawałek wzdłuż okna zostaje bramką tego okna; ściana narożna obok nie', () => {
    const gate = { side: 'n', tx: 1, ty: 1 } as const;
    const along = cutSegments([{ x0: 0, y0: 1.2, x1: 4, y1: 1.2 }], [[1, 0, 2, 2, gate]]);
    expect(along).toHaveLength(3);
    expect(along[2]).toMatchObject({ x0: 1, x1: 2, gate });
    // A gate is not cut again by the next box (it stays whole).
    const again = cutSegments([along[2]!], [[1.2, 0, 1.8, 2, gate]]);
    expect(again).toEqual([along[2]]);
    const corner = cutSegments([{ x0: 1.5, y0: 0, x1: 1.5, y1: 4 }], [[1, 0, 2, 2, gate]]);
    expect(corner.some((w) => w.gate)).toBe(false);
  });
});
