import { describe, expect, it } from 'vitest';
import { PlaceableItemSchema, WaterTankSchema, type WaterTank } from '../index.js';

const placeable = (waterTank: unknown) => ({
  id: 'test:tank',
  name: 'item.test.tank.name',
  kind: 'placeable',
  weightKg: 1,
  tags: [],
  placeable: { waterTank },
});

describe('placeable.waterTank (schemat)', () => {
  it('przyjmuje poprawny zbiornik i domyślnie refillFromMains = true', () => {
    const t: WaterTank = WaterTankSchema.parse({ capacityL: 10, quality: 'tainted' });
    expect(t).toEqual({ capacityL: 10, quality: 'tainted', refillFromMains: true });
    expect(
      WaterTankSchema.parse({ capacityL: 0.5, quality: 'clean', refillFromMains: false }),
    ).toEqual({
      capacityL: 0.5,
      quality: 'clean',
      refillFromMains: false,
    });
  });

  it.each([
    ['capacityL = 0', { capacityL: 0, quality: 'clean' }],
    ['ujemna capacityL', { capacityL: -1, quality: 'clean' }],
    ['nieskończona capacityL', { capacityL: Infinity, quality: 'clean' }],
    ['brak capacityL', { quality: 'clean' }],
    ['nieznana jakość', { capacityL: 10, quality: 'dirty' }],
    ['brak jakości', { capacityL: 10 }],
    ['refillFromMains nie boolean', { capacityL: 10, quality: 'clean', refillFromMains: 'yes' }],
    ['nieznane pole', { capacityL: 10, quality: 'clean', flow: 1 }],
  ])('odrzuca: %s', (_name, tank) => {
    expect(WaterTankSchema.safeParse(tank).success).toBe(false);
    expect(PlaceableItemSchema.safeParse(placeable(tank)).success).toBe(false);
  });

  it('pole opcjonalne w placeable', () => {
    const p = PlaceableItemSchema.parse({ ...placeable(undefined), placeable: {} });
    expect(p.placeable.waterTank).toBeUndefined();
    const q = PlaceableItemSchema.parse(placeable({ capacityL: 10, quality: 'tainted' }));
    expect(q.placeable.waterTank?.refillFromMains).toBe(true);
  });
});
