import { describe, expect, it } from 'vitest';
import { hedgeStrips } from '../osm/convert.js';
import { fillRings } from './raster.js';
import { coverZones, maskRects } from './cover.js';

describe('cover zones (sim #209: bushes / cover)', () => {
  it('maskRects covers exactly the set tiles, without overlaps', () => {
    const C = 32;
    const mask = new Uint8Array(C * C);
    let s = 7;
    for (let i = 0; i < C * C; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      mask[i] = (s >>> 16) % 3 === 0 ? 1 : 0;
    }
    // A solid block too (merges into one rectangle).
    for (let y = 4; y < 12; y++) for (let x = 20; x < 30; x++) mask[y * C + x] = 1;
    const hits = new Uint8Array(C * C);
    for (const r of maskRects(mask, C))
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) hits[y * C + x]!++;
    for (let i = 0; i < C * C; i++) expect(hits[i], `tile ${i}`).toBe(mask[i]);
  });

  it('one zone per role, bushes = 1, cover = 2', () => {
    const C = 32;
    const cls = new Uint8Array(C * C);
    for (let x = 0; x < C; x++) cls[5 * C + x] = 1;
    for (let y = 10; y < 20; y++) for (let x = 0; x < 8; x++) cls[y * C + x] = 2;
    const z = coverZones(cls, C);
    expect(z.map((v) => v.role)).toEqual(['bushes', 'cover']);
    expect(z[0]!.rects).toEqual([{ x: 0, y: 5, w: 32, h: 1 }]);
    expect(z[1]!.rects).toEqual([{ x: 0, y: 10, w: 8, h: 10 }]);
    expect(coverZones(new Uint8Array(C * C), C)).toEqual([]);
  });

  it('a diagonal hedge strip leaves no gaps in the tiles it crosses', () => {
    const C = 40;
    const set = new Uint8Array(C * C);
    for (const q of hedgeStrips([
      [3.3, 2.1],
      [30.7, 25.4],
      [35.2, 5.5],
    ]))
      fillRings([Float64Array.from(q.flat())], 0, 0, C, C, (i) => {
        set[i] = 1;
      });
    // Every tile whose centre lies on the polyline is in, the strip stays narrow.
    for (let t = 0; t <= 1; t += 0.01) {
      const x = 3.3 + (30.7 - 3.3) * t;
      const y = 2.1 + (25.4 - 2.1) * t;
      expect(set[Math.floor(y) * C + Math.floor(x)], `${x},${y}`).toBe(1);
    }
    const n = set.reduce((a, v) => a + v, 0);
    expect(n).toBeLessThan((36 + 21) * 3);
  });
});
