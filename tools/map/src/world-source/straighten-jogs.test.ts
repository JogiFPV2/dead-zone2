import { describe, expect, it } from 'vitest';
import { dropJogs, simplifyRing, tidyIrregular } from './straighten.js';

const area = (p: readonly number[]) => {
  let s = 0;
  const n = p.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++)
    s += p[2 * j]! * p[2 * i + 1]! - p[2 * i]! * p[2 * j + 1]!;
  return Math.abs(s / 2);
};

describe('outline clean-up', () => {
  it('drops a 1 m notch from a squared outline (runs h/v alternate)', () => {
    // 20 × 10 m rectangle with a 1 m step on the top wall: 6 runs → 4.
    const h = [true, false, true, false, true, false];
    const v = [0, 100, 10, 200, 100, 0]; // dm: y=0 to x=100, y=10 to x=200, y=100, x=0
    const w = [100, 10, 100, 100, 200, 100];
    const r = dropJogs(h, v, w);
    expect(r.v.length).toBe(4);
    expect(r.h).toEqual([true, false, true, false]);
  });

  it('keeps real wings (≥ 1.5 m)', () => {
    const h = [true, false, true, false, true, false];
    const v = [0, 100, 50, 200, 100, 0];
    const w = [100, 50, 100, 50, 200, 100];
    expect(dropJogs(h, v, w).v.length).toBe(6);
  });

  it('simplifies a wobbly ring and keeps its area within 15 %', () => {
    const ring: number[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const rr = 100 + (i % 2 ? 3 : -3);
      ring.push(Math.round(Math.cos(a) * rr), Math.round(Math.sin(a) * rr));
    }
    ring.push(ring[0]!, ring[1]!);
    const s = simplifyRing(ring);
    expect(s.length).toBeLessThan(ring.length);
    expect(Math.abs(area(s) - area(ring)) / area(ring)).toBeLessThan(0.15);
  });

  it('a nearly rectangular odd outline becomes a rectangle', () => {
    const ring = [0, 0, 200, 0, 200, 100, 120, 100, 110, 96, 100, 100, 0, 100, 0, 0];
    const [r] = tidyIrregular([ring]);
    expect((r!.length >> 1) - 1).toBe(4);
  });
});
