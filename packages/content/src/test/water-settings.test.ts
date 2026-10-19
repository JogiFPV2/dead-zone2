import { describe, expect, it } from 'vitest';
import {
  WaterContainerSchema,
  WaterSettingsSchema,
  WorldSettingsSchema,
  type WaterContainer,
  type WaterSettings,
} from '../index.js';
import { baseBundle } from './base-bundle.js';
import { SIM_POISONING } from './water-poisoning-sim.js';

/** Values 1:1 with the sim constants of #260 (`packages/sim/src/furniture/water.ts`). */
const SIM = {
  TANK_DRINK_L: 0.25,
  BOTTLE_L: 0.5,
  FILL_MIN: 0.5,
  WATER_ITEMS: {
    empty: 'base:bottle',
    clean: 'base:water-bottle',
    tainted: 'base:dirty-water-bottle',
  },
};

describe('waterContainer (schemat)', () => {
  it('przyjmuje capacityL > 0, odrzuca 0, ujemne, brak i nieznane pola', () => {
    const c: WaterContainer = WaterContainerSchema.parse({ capacityL: 0.5 });
    expect(c).toEqual({ capacityL: 0.5 });
    for (const bad of [
      { capacityL: 0 },
      { capacityL: -1 },
      { capacityL: Infinity },
      {},
      { capacityL: 1, x: 1 },
    ])
      expect(WaterContainerSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe('worldSettings.water (schemat)', () => {
  it('domyślne wartości = stałe sim', () => {
    const w: WaterSettings = WaterSettingsSchema.parse(undefined);
    expect(w).toEqual({
      tankDrinkL: SIM.TANK_DRINK_L,
      fillMin: SIM.FILL_MIN,
      bottles: SIM.WATER_ITEMS,
    });
    expect(WorldSettingsSchema.shape.water.parse(undefined)).toEqual(w);
  });

  it('odrzuca złe wartości', () => {
    for (const bad of [
      { tankDrinkL: 0 },
      { tankDrinkL: -0.1 },
      { fillMin: -1 },
      { bottles: { empty: '' } },
      { flow: 1 },
    ])
      expect(WaterSettingsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe('woda w paczce bazowej (1:1 ze stałymi sim z #260)', () => {
  it('world-settings/water.json', async () => {
    const w = (await baseBundle()).worldSettings.water;
    expect(w).toEqual({
      tankDrinkL: SIM.TANK_DRINK_L,
      fillMin: SIM.FILL_MIN,
      bottles: SIM.WATER_ITEMS,
      poisoning: SIM_POISONING,
    });
  });

  it('butelki istnieją i mają waterContainer.capacityL = BOTTLE_L', async () => {
    const b = await baseBundle();
    for (const id of Object.values(b.worldSettings.water.bottles)) {
      expect(b.items[id], id).toBeDefined();
      expect(b.items[id]!.waterContainer, id).toEqual({ capacityL: SIM.BOTTLE_L });
    }
    const withField = Object.values(b.items)
      .filter((i) => i.waterContainer)
      .map((i) => i.id);
    expect(withField.sort()).toEqual(Object.values(SIM.WATER_ITEMS).sort());
  });
});
