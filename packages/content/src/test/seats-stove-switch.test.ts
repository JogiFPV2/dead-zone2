import { describe, expect, it } from 'vitest';
import { footprintOf } from '../footprint/footprint-of.js';
import { FURNITURE_TYPES_PL } from '../i18n/furniture-labels.js';
import { baseBundle } from './base-bundle.js';

/** Content for the sim's rest (#220), cooking (#241) and light switches (#242). */
describe('siedziska, kuchenka gazowa, włącznik światła', () => {
  it('krzesło i fotel: placeable.seat (pełny rest), 1×1, bez schowka', async () => {
    const b = await baseBundle();
    for (const id of ['base:chair', 'base:armchair']) {
      const it = b.items[id]!;
      expect(it.kind, id).toBe('placeable');
      if (it.kind !== 'placeable') continue;
      expect(it.placeable.seat, id).toBe(true);
      expect(it.placeable.sleepSurface, id).toBeUndefined();
      expect(it.placeable.containerType, id).toBeUndefined();
      expect(footprintOf(it), id).toEqual({ w: 1, h: 1 });
    }
    expect(FURNITURE_TYPES_PL.seat).toBeTruthy();
  });

  it('kuchenka gazowa: gaz w palnikach i piekarniku, stacja ognia jak base:range, schowek', async () => {
    const b = await baseBundle();
    const it = b.items['base:gas-stove']!;
    const range = b.items['base:range']!;
    expect(it.kind).toBe('placeable');
    if (it.kind !== 'placeable' || range.kind !== 'placeable') return;
    expect(it.placeable.cooking).toEqual({ burners: 'gas', oven: 'gas' });
    expect(it.placeable.station).toEqual(range.placeable.station);
    expect(it.placeable.containerType).toBe('base:gas-stove');
    expect(b.containers['base:gas-stove']).toBeDefined();
    // Item and container type agree on the size (footprint test of the pack).
    expect(footprintOf(it)).toEqual(footprintOf(b.containers['base:gas-stove']));
    expect(FURNITURE_TYPES_PL.stove).toBeTruthy();
  });

  it('włącznik światła: tag lighting.switchTag, nie blokuje (bez footprintu i schowka)', async () => {
    const b = await baseBundle();
    const tag = b.worldSettings.lighting.switchTag;
    const switches = Object.values(b.items).filter((i) => i.tags.includes(tag));
    expect(switches.map((s) => s.id)).toEqual(['base:light-switch']);
    const s = switches[0]!;
    expect(s.kind).toBe('placeable');
    if (s.kind === 'placeable') expect(s.placeable).toEqual({});
    expect(FURNITURE_TYPES_PL['light-switch']).toBeTruthy();
  });
});
