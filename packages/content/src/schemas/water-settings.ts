import { z } from 'zod';
import { GameMinutesSchema, ItemRefSchema } from './common/index.js';

const BOTTLES_DEFAULTS = {
  empty: 'base:bottle',
  clean: 'base:water-bottle',
  tainted: 'base:dirty-water-bottle',
};

/** Butelki akcji `fill-water`: pusta i to, czym staje się po napełnieniu czystą / brudną wodą. */
const WaterBottlesSchema = z
  .strictObject({
    empty: ItemRefSchema.default(BOTTLES_DEFAULTS.empty),
    clean: ItemRefSchema.default(BOTTLES_DEFAULTS.clean),
    tainted: ItemRefSchema.default(BOTTLES_DEFAULTS.tainted),
  })
  .default(BOTTLES_DEFAULTS);

/**
 * Picie i napełnianie wody (Symulacja, docs 9.59): `drink-tank` bierze `tankDrinkL` litrów ze
 * zbiornika (`placeable.waterTank`), `fill-water` przy zbiorniku albo kranie trwa `fillMin` minut
 * gry. Pojemność butelki: `waterContainer.capacityL` przedmiotu.
 */
export const WaterSettingsSchema = z
  .strictObject({
    tankDrinkL: z.number().positive().finite().default(0.25),
    fillMin: GameMinutesSchema.default(0.5),
    bottles: WaterBottlesSchema,
  })
  .prefault({});

export type WaterSettings = z.infer<typeof WaterSettingsSchema>;
