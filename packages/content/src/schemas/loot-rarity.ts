import { z } from 'zod';

/** Rzadkość wpisu lootu. Waga losowania zostaje w `weight`; rzadkość skaluje ją ustawieniem świata. */
export const LOOT_RARITIES = ['common', 'uncommon', 'rare', 'very_rare'] as const;
export const LootRaritySchema = z.enum(LOOT_RARITIES);

const pct = (value: number) => z.number().int().min(0).max(1000).default(value);

/**
 * `worldSettings.loot`: waga efektywna wpisu = max(1, floor(weight × pct / 100)) albo 0,
 * gdy pct = 0 (wszystko w liczbach całkowitych, jak `pickWeighted` w Symulacji).
 */
export const LootSettingsSchema = z
  .strictObject({
    rarityWeightPct: z
      .strictObject({
        common: pct(100),
        uncommon: pct(100),
        rare: pct(100),
        very_rare: pct(100),
      })
      .prefault({}),
  })
  .prefault({});

export type LootRarity = z.infer<typeof LootRaritySchema>;
export type LootSettings = z.infer<typeof LootSettingsSchema>;
