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
});
