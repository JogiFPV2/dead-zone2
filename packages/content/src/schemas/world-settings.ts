import { z } from 'zod';
import { CapacityKgSchema, ExtSchema } from './common/index.js';
import { CraftingSettingsSchema } from './crafting-settings.js';
import { LootSettingsSchema } from './loot-rarity.js';
import { VisionSettingsSchema } from './vision-settings.js';
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
      /** Mnożnik tempa zmęczenia przy przeciążeniu (spowolnienie ruchu daje moodle `heavy-load`). */
      overloadFatigueMul: z.number().min(1).max(10).default(1.5),
      /** Twardy limit jako wielokrotność udźwigu — powyżej nie da się podnieść przedmiotu. */
      hardLimitMultiplier: z.number().min(1).max(10).default(2),
    })
    .default({ baseCapacityKg: 12, overloadFatigueMul: 1.5, hardLimitMultiplier: 2 }),
  /** Stałe przetrwania dla Symulacji (Etap 2). */
  survival: SurvivalSettingsSchema,
  /** Skalowanie rzadkości lootu (sandbox). */
  loot: LootSettingsSchema,
  /** Crafting i łączenie: skąd brać składniki. */
  crafting: CraftingSettingsSchema,
  /** Zasięg widzenia w dzień i w nocy, bonus światła. */
  vision: VisionSettingsSchema,
  ext: ExtSchema,
});

export type WorldSettings = z.infer<typeof WorldSettingsSchema>;
