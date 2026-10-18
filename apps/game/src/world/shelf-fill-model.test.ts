import { describe, expect, it } from 'vitest';
import {
  DRESSING_MAX,
  DRESSING_MIN,
  SHELF_PROFILES,
  displayFill,
  TILE_FIT_WIDTH,
  hashId,
  layoutProfile,
  propSlots,
  slotCount,
  visibleProps,
} from './shelf-fill-model.js';

describe('shelf fill model', () => {
  it('matches the spec slot counts', () => {
    expect(slotCount(SHELF_PROFILES['base:kitchen-cabinet']!)).toBe(12);
    expect(slotCount(SHELF_PROFILES['base:fridge']!)).toBe(12);
    expect(slotCount(SHELF_PROFILES['base:bookshelf']!)).toBe(18);
  });

  it('shows at least one prop when not empty and rounds up', () => {
    expect(visibleProps(0, 12)).toBe(0);
    expect(visibleProps(0.01, 12)).toBe(1);
    expect(visibleProps(0.5, 12)).toBe(6);
    expect(visibleProps(11 / 24, 12)).toBe(6);
    expect(visibleProps(10 / 24, 12)).toBe(5);
    expect(visibleProps(1, 12)).toBe(12);
    expect(visibleProps(1.4, 12)).toBe(12);
  });

  it('dresses unsearched storage and shows the real fill after a search', () => {
    for (const id of [1, 7, 42, 999]) {
      const f = displayFill(0, false, id);
      expect(f).toBeGreaterThanOrEqual(DRESSING_MIN);
      expect(f).toBeLessThanOrEqual(DRESSING_MAX);
      expect(displayFill(0, false, id)).toBe(f);
    }
    expect(displayFill(0, true, 1)).toBe(0);
    expect(displayFill(0.05, true, 1)).toBeCloseTo(0.44);
    expect(displayFill(0.5, true, 1)).toBe(1);
    expect(displayFill(1, false, 1)).toBe(1);
  });

  it('keeps a stable seeded slot order per container', () => {
    const p = SHELF_PROFILES['base:kitchen-cabinet']!;
    const a = propSlots(p, hashId(42));
    expect(propSlots(p, hashId(42))).toEqual(a);
    expect(propSlots(p, hashId(43))).not.toEqual(a);
    expect(a).toHaveLength(12);
    const [w, h] = p.size;
    for (const s of a) {
      expect(Math.abs(s.x)).toBeLessThan(w / 2);
      expect(s.y).toBeLessThan(h);
      expect(['can', 'box', 'jar']).toContain(s.kind);
    }
  });

  it('metal rack 2×1 (real-scale): 5 shelves at the model heights, real width with footprints', () => {
    const p = SHELF_PROFILES['base:metal-shelf']!;
    const on = layoutProfile(p, true);
    expect(on).toBe(p);
    const slots = propSlots(on, 7);
    expect(slots).toHaveLength(5 * 10);
    const ys = [...new Set(slots.map((s) => Number((s.y / 1.8).toFixed(3))))].sort();
    expect(ys).toEqual([0.044, 0.28, 0.51, 0.74, 0.98]);
    for (const s of slots) expect(Math.abs(s.z - -0.29)).toBeLessThanOrEqual(0.03 + 1e-9);
    // Across the 1.8 m rack around footprintCenter, not just the anchor tile.
    expect(Math.max(...slots.map((s) => Math.abs(s.x)))).toBeGreaterThan(0.55);
    for (const s of slots) expect(Math.abs(s.x)).toBeLessThan(0.9);
  });

  it('footprints off: the rack layout is squeezed into one tile like its model', () => {
    const p = SHELF_PROFILES['base:metal-shelf']!;
    const off = layoutProfile(p, false);
    expect(off.size).toEqual([TILE_FIT_WIDTH, 1.8, 0.4]);
    expect(off.cols).toBe(5);
    expect(slotCount(off)).toBeLessThanOrEqual(slotCount(p));
    for (const s of propSlots(off, 7)) expect(Math.abs(s.x)).toBeLessThan(0.48);
    // One-tile profiles are untouched either way.
    const book = SHELF_PROFILES['base:bookshelf']!;
    expect(layoutProfile(book, false)).toBe(book);
  });
});
