import { z } from 'zod';
import {
  CapacityKgSchema,
  ContentIdSchema,
  GameMinutesSchema,
  ExtSchema,
  I18nKeySchema,
  ItemRefSchema,
  LootTableRefSchema,
  TagListSchema,
} from './common/index.js';

/**
 * Schowek w świecie: skrzynia, szafka, lodówka, bagażnik, stawiana skrzynia z desek.
 * Zawartość zapisuje się w stanie chunka; tu jest tylko definicja typu.
 */
export const ContainerTypeSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  category: z.enum([
    'cabinet',
    'fridge',
    'freezer',
    'chest',
    'crate',
    'shelf',
    'trunk',
    'counter',
    'other',
  ]),
  tags: TagListSchema,
  capacityKg: CapacityKgSchema,
  /** Mnożnik szybkości psucia (lodówka 0.25, zamrażarka 0.05). Działa przy zasilaniu. */
  spoilageMultiplier: z.number().min(0).max(1).default(1),
  requiresPower: z.boolean().default(false),
  /** Czas akcji „Przeszukaj”. */
  searchMin: GameMinutesSchema.default(1),
  /** Gracz może go podnieść i przenieść (jako ten przedmiot). */
  pickupItem: ItemRefSchema.optional(),
  /** Domyślny loot, gdy mapa nie wskaże innego. */
  defaultLootTable: LootTableRefSchema.optional(),
  model: z.string().optional(),
  ext: ExtSchema,
});

export type ContainerType = z.infer<typeof ContainerTypeSchema>;
