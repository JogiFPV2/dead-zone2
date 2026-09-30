import { z } from 'zod';
import { CapacityKgSchema, ExtSchema } from './common/index.js';
import { CraftingSettingsSchema } from './crafting-settings.js';
import { LootSettingsSchema } from './loot-rarity.js';
import { SurvivalSettingsSchema } from './survival/index.js';

/**
 * Ustawienia świata — pojedynczy obiekt z `world-settings.json` w korzeniu paczki i opcjonalnych
 * fragmentów `world-settings/*.json` (np. po kategorii przetrwania). Wszystkie pliki paczek łączy
 * głęboki merge w kolejności wczytywania; każde pole ma wartość domyślną.
 */
export const WorldSettingsSchema = z.strictObject({
  /** Długość doby gry w minutach rzeczywistych. */
  dayLengthMinutes: z
    .number()
    .positive()
    .max(24 * 60)
    .default(60),
  /** Punkty na cechy przy tworzeniu postaci (przed zawodem i cechami). */
  startingTraitPoints: z.number().int().min(0).max(100).default(0),
  carry: z
    .strictObject({
      /** Bazowy limit udźwigu postaci (stat `carry-capacity-kg` modyfikują cechy i siła). */
      baseCapacityKg: CapacityKgSchema.default(12),
      /** Powyżej limitu: spowolnienie ruchu za każdy kg nadwagi (ułamek prędkości). */
      overloadSlowdownPerKg: z.number().min(0).max(1).default(0.03),
      /** Twardy limit jako wielokrotność udźwigu — powyżej nie da się podnieść przedmiotu. */
      hardLimitMultiplier: z.number().min(1).max(10).default(2),
    })
    .default({ baseCapacityKg: 12, overloadSlowdownPerKg: 0.03, hardLimitMultiplier: 2 }),
  /** Stałe przetrwania dla Symulacji (Etap 2). */
  survival: SurvivalSettingsSchema,
  /** Skalowanie rzadkości lootu (sandbox). */
  loot: LootSettingsSchema,
  /** Crafting i łączenie: skąd brać składniki. */
  crafting: CraftingSettingsSchema,
  ext: ExtSchema,
});

export type WorldSettings = z.infer<typeof WorldSettingsSchema>;
