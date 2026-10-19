import { expect, it } from 'vitest';
import { FollowWindow } from './follow-window.js';

it('follows the player across the whole map, rebuilding only when due', () => {
  const b = { cx0: 0, cy0: 0, cx1: 703, cy1: 703 };
  const w = new FollowWindow(b, { x: 100, y: 100 }, 8, 2, 1000);
  expect(w.range).toEqual({ cx0: 0, cy0: 0, cx1: 11, cy1: 11, z: 0 });
  // First call: the streamed chunks count is new.
  expect(w.update({ x: 100, y: 100 }, 10, 0)).toBe(true);
  // Too early / nothing changed.
  expect(w.update({ x: 20000, y: 20000 }, 10, 500)).toBe(false);
  expect(w.update({ x: 110, y: 100 }, 10, 2000)).toBe(false);
  // Far away: the window is around the player (no ±12 limit around the start).
  expect(w.update({ x: 20000, y: 21000 }, 10, 3000)).toBe(true);
  expect(w.range).toEqual({ cx0: 617, cy0: 648, cx1: 633, cy1: 664, z: 0 });
  // Clamped at the world edge.
  expect(w.update({ x: 22520, y: 22520 }, 10, 5000)).toBe(true);
  expect(w.range.cx1).toBe(703);
  // New chunks streamed in → rebuild in place.
  expect(w.update({ x: 22520, y: 22520 }, 30, 7000)).toBe(true);
});
