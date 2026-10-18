import { describe, expect, it } from 'vitest';
import { footprintOf } from '../footprint/footprint-of.js';
import { baseBundle } from './base-bundle.js';

describe('toaleta base:toilet', () => {
  it('mebel 1×1 (blokuje kafel), bez schowka, tag base:toilet', async () => {
    const t = (await baseBundle()).items['base:toilet']!;
    expect(t.kind).toBe('placeable');
    if (t.kind !== 'placeable') return;
    expect(t.placeable.footprint).toEqual({ w: 1, h: 1 });
    expect(footprintOf(t)).toEqual({ w: 1, h: 1 });
    expect(t.placeable.containerType).toBeUndefined();
    expect(t.tags).toEqual(['base:furniture', 'base:toilet']);
  });

  it('nie jest kranem, prysznicem ani wanną: woda z sieci to czysta woda do picia', async () => {
    const b = await baseBundle();
    const h = b.worldSettings.survival.hygiene;
    const t = b.items['base:toilet']!;
    for (const tag of [h.tapTag, h.showerTag, h.bathTag]) expect(t.tags).not.toContain(tag);
  });
});
