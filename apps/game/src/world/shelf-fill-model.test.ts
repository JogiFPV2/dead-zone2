import { describe, expect, it } from 'vitest';
import { SHELF_PROFILES, hashId, propSlots, slotCount, visibleProps } from './shelf-fill-model.js';

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
});
