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
  /**
   * Przedmioty porozrzucane po mapie (spawn przy starcie świata, deterministyczny z seeda): w
   * każdym chunku `perChunk` losowań; każde wybiera losowy kafel podłogi pasujący do `terrain`
   * (id albo tag kafla z `tiles/`, pusta lista = każdy) i do `zones` (rola, id albo tag strefy
   * mapy, np. krzaki, rowy; pusta lista = bez warunku), a na nim jeden przedmiot z `entries`.
   * Z szansą `hiddenChance` przedmiot jest schowany: nie widać go, dopóki ktoś nie przeszuka
   * miejsca (`search {x, y}`). `outdoor` = tylko kafle poza pomieszczeniami.
   */
  scatter: z
    .strictObject({
      terrain: z.array(TagSchema).default([]),
      zones: z.array(z.string().min(1).max(128)).default([]),
      outdoor: z.boolean().default(true),
      perChunk: IntRangeSchema,
      hiddenChance: FractionSchema.default(0),
    })
    .optional(),
  ext: ExtSchema,
});

export type LootEntry = z.infer<typeof LootEntrySchema>;
export type LootTable = z.infer<typeof LootTableSchema>;
