import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_WORLD_SIZE,
  planWorld,
  ROAD_WIDTH,
  RoadIndex,
  type Footprint,
  type RoadClass,
} from './plan.js';
import { planStats } from './stats.js';

const digest = (o: unknown) => createHash('sha1').update(JSON.stringify(o)).digest('hex');
const big = planWorld({ seed: 1993 });
const small = planWorld({ seed: 7, size: FALLBACK_WORLD_SIZE });

function corners(b: Footprint) {
  const c = Math.cos(b.a);
  const s = Math.sin(b.a);
  return [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
    [0, 0],
  ].map(([i = 0, j = 0]) => ({
    x: b.x + ((i * b.w) / 2) * c - ((j * b.h) / 2) * s,
    y: b.y + ((i * b.w) / 2) * s + ((j * b.h) / 2) * c,
  }));
}

// Full 16 km plans take seconds each on CI runners.
describe('planWorld', { timeout: 60_000 }, () => {
  it('is a pure function of (seed, size)', () => {
    expect(digest(planWorld({ seed: 1993 }))).toBe(digest(big));
    expect(digest(planWorld({ seed: 1994 }))).not.toBe(digest(big));
  });

  it('takes the world size as a parameter (16 km default, 8 km fallback)', () => {
    expect(big.size).toBe(16384);
    expect(big.chunks).toBe(512);
    expect(small.size).toBe(8192);
    expect(small.chunks).toBe(256);
    expect(() => planWorld({ seed: 1, size: 1000 })).toThrow();
    for (const p of [big, small])
      for (const b of p.buildings) {
        expect(b.x).toBeGreaterThan(0);
        expect(b.y).toBeGreaterThan(0);
        expect(b.x).toBeLessThan(p.size);
        expect(b.y).toBeLessThan(p.size);
      }
  });

  it('has cities, towns and villages with their complexes', () => {
    for (const p of [big, small]) {
      const kinds = p.settlements.map((s) => s.kind);
      expect(kinds).toContain('city');
      expect(kinds.filter((k) => k === 'town').length).toBeGreaterThanOrEqual(2);
      expect(kinds.filter((k) => k === 'village').length).toBeGreaterThanOrEqual(6);
      for (const c of p.settlements.filter((s) => s.kind === 'city')) {
        const here = p.complexes.filter((k) => k.settlement === c.id).map((k) => k.kind);
        expect(here).toContain('hospital');
        expect(here).toContain('police');
        expect(here).toContain('station');
      }
      expect(p.complexes.some((k) => k.kind === 'military')).toBe(true);
      expect(
        p.complexes.filter((k) => k.kind === 'gas' && k.settlement < 0).length,
      ).toBeGreaterThan(0);
      for (const cls of ['highway', 'main', 'local', 'street', 'track', 'path', 'rail'] as const)
        expect(
          p.roads.some((r) => r.cls === cls),
          cls,
        ).toBe(true);
    }
  });

  it('keeps buildings off the roads', () => {
    for (const p of [big, small]) {
      const idx = new RoadIndex(p.size, p.roads);
      p.roads.forEach((_, i) => idx.add(i));
      const classes: RoadClass[] = ['highway', 'main', 'local', 'street'];
      let bad = 0;
      for (const b of p.buildings)
        for (const q of corners(b))
          for (const cls of classes) {
            const hit = idx.nearest(q.x, q.y, ROAD_WIDTH[cls], (c) => c === cls);
            if (hit && hit.d < ROAD_WIDTH[cls] / 2 - 0.5) bad++;
          }
      expect(bad).toBe(0);
    }
  });

  it('leaves no empty wilderness: roads or paths everywhere, something in nearly every cell', () => {
    for (const p of [big, small]) {
      const s = planStats(p);
      expect(s.emptyCells).toBeLessThan(0.15);
      expect(s.p95RoadDist).toBeLessThan(700);
      expect(s.cover.forest).toBeGreaterThan(0.2);
      expect(s.cover.forest).toBeLessThan(0.45);
    }
  });
});
