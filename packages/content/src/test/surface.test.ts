import { describe, expect, it } from 'vitest';
import { ContainerTypeSchema, PlaceableItemSchema } from '../index.js';
import { onSurfaceForId, surfaceHeightForId } from '../footprint/index.js';
import { baseBundle } from './base-bundle.js';

const placeable = (p: Record<string, unknown>) => ({
  id: 'test:x',
  name: 'item.test.x.name',
  kind: 'placeable',
  weightKg: 1,
  tags: [],
  placeable: p,
});

describe('surfaceHeightM / onSurface (schemat)', () => {
  it('placeable: oba pola opcjonalne; wysokość > 0 i ≤ 3 m, onSurface boolean', () => {
    expect(PlaceableItemSchema.safeParse(placeable({})).success).toBe(true);
    expect(PlaceableItemSchema.safeParse(placeable({ surfaceHeightM: 0.75 })).success).toBe(true);
    expect(PlaceableItemSchema.safeParse(placeable({ onSurface: true })).success).toBe(true);
    for (const bad of [
      { surfaceHeightM: 0 },
      { surfaceHeightM: -1 },
      { surfaceHeightM: 4 },
      { onSurface: 1 },
    ])
      expect(PlaceableItemSchema.safeParse(placeable(bad)).success, JSON.stringify(bad)).toBe(
        false,
      );
  });

  it('typ schowka: surfaceHeightM', () => {
    const c = {
      id: 'test:c',
      name: 'container.test.c.name',
      category: 'cabinet',
      tags: [],
      capacityKg: 1,
    };
    expect(ContainerTypeSchema.safeParse({ ...c, surfaceHeightM: 0.55 }).success).toBe(true);
    expect(ContainerTypeSchema.safeParse({ ...c, surfaceHeightM: 0 }).success).toBe(false);
  });
});

describe('blaty i meble na blatach w paczce bazowej', () => {
  it('wysokości blatów (szafka RTV, biurko, stół, lada sklepowa)', async () => {
    const b = await baseBundle();
    expect(surfaceHeightForId(b, 'base:tv-stand')).toBe(0.55);
    expect(surfaceHeightForId(b, 'base:desk')).toBe(0.75);
    expect(surfaceHeightForId(b, 'base:table')).toBe(0.75);
    expect(surfaceHeightForId(b, 'base:shop-counter')).toBe(0.95);
    expect(surfaceHeightForId(b, 'base:bed')).toBeUndefined();
  });

  it('onSurface: telewizor, magnetowid, radio, lampka biurkowa; nie lampa stojąca ani włącznik', async () => {
    const b = await baseBundle();
    for (const id of ['base:tv', 'base:vcr', 'base:radio-set', 'base:desk-lamp'])
      expect(onSurfaceForId(b, id), id).toBe(true);
    for (const id of ['base:floor-lamp', 'base:light-switch', 'base:ceiling-lamp', 'base:tv-stand'])
      expect(onSurfaceForId(b, id), id).toBe(false);
  });
});
