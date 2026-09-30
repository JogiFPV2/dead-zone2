import { z } from 'zod';
import { FractionSchema } from '../common/index.js';
import { itemBaseShape } from './base.js';
import { DurabilitySchema } from './durability.js';
import { EquipSlotSchema } from './equip-slot.js';

export const ClothingItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('clothing'),
  clothing: z.strictObject({
    slot: EquipSlotSchema,
    /** Izolacja cieplna 0..1. */
    insulation: FractionSchema.default(0),
    /** Odporność na wodę 0..1 (moodle „Mokry”). */
    waterResistance: FractionSchema.default(0),
    protection: z
      .strictObject({ scratch: FractionSchema.default(0), bite: FractionSchema.default(0) })
      .default({ scratch: 0, bite: 0 }),
    /** Mała kieszeń: dodatkowa pojemność w kg. */
    pocketCapacityKg: z.number().min(0).default(0),
    durability: DurabilitySchema.optional(),
  }),
});

export type ClothingItem = z.infer<typeof ClothingItemSchema>;
