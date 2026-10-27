import { describe, expect, it } from 'vitest';
import { windowEdges, windowPerRoom, type OuterEdge } from './window-rhythm.js';

/** North wall of a w-tile facade at y = 0. */
const wall = (w: number): OuterEdge[] =>
  Array.from({ length: w }, (_, x) => ({ x, y: 0, side: 'n' as const, along: x }));

describe('window rhythm', () => {
  it('one window about every 3 m, corners solid', () => {
    const win = windowEdges(wall(12), 3, new Set());
    const xs = [...win].map((k) => Number(k.split(',')[0])).sort((a, b) => a - b);
    expect(xs).toEqual([1, 4, 7, 10]);
  });

  it('density ≈ 1 window per 3 m of facade (per storey)', () => {
    for (const w of [6, 9, 10, 15, 24, 60]) {
      const n = windowEdges(wall(w), 3, new Set()).size;
      expect(n / w).toBeGreaterThanOrEqual(1 / 4.5);
      expect(n / w).toBeLessThanOrEqual(1 / 2.5);
    }
  });

  it('no window on or next to a door', () => {
    const win = windowEdges(wall(12), 3, new Set(['4,0,n']));
    for (const x of [3, 4, 5]) expect(win.has(`${x},0,n`)).toBe(false);
    expect(win.size).toBe(3);
  });

  it('separate runs on one line each get their own rhythm; 1 m stubs none', () => {
    const e = [...wall(4), { x: 9, y: 0, side: 'n' as const, along: 9 }];
    const win = windowEdges(e, 3, new Set());
    expect(win.has('9,0,n')).toBe(false);
    expect(win.size).toBe(1);
  });

  it('2.5 m rhythm: ≈ 1 window per 2.5 m, alternating 2 / 3 m gaps', () => {
    const win = windowEdges(wall(12), 2.5, new Set());
    const xs = [...win].map((k) => Number(k.split(',')[0])).sort((a, b) => a - b);
    expect(xs).toEqual([1, 4, 6, 9]);
    for (const w of [10, 20, 40, 60]) {
      const n = windowEdges(wall(w), 2.5, new Set()).size;
      expect(n / w).toBeGreaterThanOrEqual(1 / 3.4);
      expect(n / w).toBeLessThanOrEqual(1 / 2.2);
    }
  });

  it('a room without a window on its outer wall gets one', () => {
    const e = wall(12);
    const win = windowEdges(e, 3, new Set());
    // Room B (x 2..3) between windows at 1 and 4 has none of its own.
    const room = (x: number) => (x === 2 || x === 3 ? 'B' : 'A');
    windowPerRoom(e, (x) => room(x), win, new Set());
    expect([...win].some((k) => room(Number(k.split(',')[0])) === 'B')).toBe(true);
  });
});
