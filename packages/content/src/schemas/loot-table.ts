import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  FractionSchema,
  IntRangeSchema,
  ItemRefSchema,
  LootTableRefSchema,
  TagListSchema,
  TagSchema,
} from './common/index.js';
import { LootRaritySchema } from './loot-rarity.js';

const entryShape = {
  /** Całkowita waga losowania względem innych wpisów (`pickWeighted` w Symulacji). */
  weight: z.number().int().positive(),
  count: IntRangeSchema.default({ min: 1, max: 1 }),
  /** Rzadkość; `worldSettings.loot.rarityWeightPct` skaluje wagę. */
  rarity: LootRaritySchema.default('common'),
};

/** Wpis: konkretny przedmiot albo zagnieżdżona tabela (np. `base:loot/cutlery`). */
export const LootEntrySchema = z.union([
  z.strictObject({ item: ItemRefSchema, ...entryShape }),
  z.strictObject({ table: LootTableRefSchema, ...entryShape }),
]);

export const LootTableSchema = z.strictObject({
  id: ContentIdSchema,
  tags: TagListSchema,
  /** Typy pomieszczeń, do których pasuje (np. `base:room/kitchen`). */
  rooms: z.array(TagSchema).default([]),
  /** Typy schowków, np. `base:fridge` (id z katalogu containers/). */
  containers: z.array(ContentIdSchema).default([]),
  /** Szansa, że schowek w ogóle coś ma. */
  chance: FractionSchema.default(1),
  rolls: IntRangeSchema,
  entries: z.array(LootEntrySchema).min(1),
  ext: ExtSchema,
});

export type LootEntry = z.infer<typeof LootEntrySchema>;
export type LootTable = z.infer<typeof LootTableSchema>;
