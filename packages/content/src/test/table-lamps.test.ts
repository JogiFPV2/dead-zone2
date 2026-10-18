import { describe, expect, it } from 'vitest';
import { footprintOf } from '../footprint/footprint-of.js';
import { baseBundle } from './base-bundle.js';

describe('stół i lampy na prąd', () => {
  it('base:table: mebel 2×1 bez schowka i siedziska', async () => {
    const t = (await baseBundle()).items['base:table']!;
    expect(t.kind).toBe('placeable');
    if (t.kind !== 'placeable') return;
    expect(footprintOf(t)).toEqual({ w: 2, h: 1 });
    expect(t.placeable.containerType).toBeUndefined();
    expect(t.placeable.seat).toBeUndefined();
    expect(t.tags).toContain('base:furniture');
  });

  it('lampy sufitowa, stojąca, biurkowa: światło na prąd (włącznik #242), tag base:light, nie blokują', async () => {
    const b = await baseBundle();
    for (const id of ['base:ceiling-lamp', 'base:floor-lamp', 'base:desk-lamp']) {
      const l = b.items[id]!;
      expect(l.kind, id).toBe('placeable');
      if (l.kind !== 'placeable') continue;
      expect(l.placeable.light?.requiresPower, id).toBe(true);
      expect(l.tags, id).toContain('base:light');
      expect(l.placeable.footprint, id).toBeUndefined();
      expect(l.placeable.containerType, id).toBeUndefined();
    }
    const r = (id: string) => {
      const l = b.items[id]!;
      return l.kind === 'placeable' ? (l.placeable.light?.radiusTiles ?? 0) : 0;
    };
    expect(r('base:ceiling-lamp')).toBeGreaterThan(r('base:floor-lamp'));
    expect(r('base:floor-lamp')).toBeGreaterThan(r('base:desk-lamp'));
  });
});
