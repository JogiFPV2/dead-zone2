import { z } from 'zod';
import {
  ContentIdSchema,
  FractionSchema,
  IntRangeSchema,
  LootTableRefSchema,
  RealSecondsSchema,
  RoomTypeSchema,
  TilesSchema,
} from './common/index.js';
import { LootCategorySchema } from './loot-category.js';

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
    /**
     * Akcja „Przeszukaj” (komenda `search`): czas w sekundach rzeczywistych przy ×1 dla zwłok,
     * miejsc (kafel, krzak, rów) i schowków bez własnego `searchMin`; przeszukanie miejsca odkrywa
     * schowane przedmioty w promieniu `spotRadiusTiles` od wskazanego kafla.
     */
    search: z
      .strictObject({
        searchSec: RealSecondsSchema.default(3.5),
        spotRadiusTiles: TilesSchema.default(1.5),
      })
      .prefault({}),
    /**
     * Co realnie leży w danym typie pomieszczenia (kuchnia → jedzenie i przybory kuchenne).
     * Druga oś obok `lootAccepts` schowka; brak typu = bez ograniczeń. Sprawdza test paczki.
     */
    roomAccepts: z.record(RoomTypeSchema, z.array(LootCategorySchema)).default({}),
    /**
     * Zużycie łupu: z szansą `wornChance` przedmiot ze stanem (broń, narzędzia, ubrania) ma
     * losowo `minPct`–`maxPct` % wytrzymałości, a leki i napoje z kilkoma porcjami — część
     * zużytą (np. napoczęte tabletki). Reszta jest nowa. Domyślnie 0 = wszystko nowe.
     */
    wear: z
      .strictObject({
        wornChance: FractionSchema.default(0),
        minPct: z.number().int().min(1).max(100).default(100),
        maxPct: z.number().int().min(1).max(100).default(100),
      })
      .refine((w) => w.minPct <= w.maxPct, {
        message: 'minPct musi być ≤ maxPct',
        path: ['maxPct'],
      })
      .prefault({}),
    /** Ile przedmiotów leży na podłodze pomieszczenia, gdy w ogóle coś leży (domyślnie 1). */
    floorRoomItems: IntRangeSchema.default({ min: 1, max: 1 }),
    /**
     * Charakter budynku: każdy budynek losuje jeden profil (waga `weight`, z seeda świata i id
     * budynku). Profil mnoży szansę i liczbę losowań każdego schowka w budynku (splądrowany:
     * prawie pusto) i dokłada osobne losowania z tabel `extra` do pasujących schowków (chomik:
     * zapasy w szafkach kuchennych, myśliwy: broń w szafie). Brak listy = wszystkie budynki zwykłe.
     */
    buildingProfiles: z
      .array(
        z.strictObject({
          id: ContentIdSchema,
          weight: z.number().int().min(1),
          /** Mnożnik szansy schowka w procentach (100 = bez zmian). */
          chancePct: z.number().int().min(0).max(1000).default(100),
          /** Dodatek do liczby losowań (ujemny = mniej, minimum 0). */
          rollsAdd: z.number().int().min(-10).max(10).default(0),
          extra: z
            .array(
              z.strictObject({
                table: LootTableRefSchema,
                /** Typy schowków (id z `containers/`), do których trafia. */
                containers: z.array(ContentIdSchema).min(1),
                /** Tylko w tych pomieszczeniach (pusta lista = każde). */
                rooms: z.array(RoomTypeSchema).default([]),
                chance: FractionSchema.default(1),
              }),
            )
            .default([]),
        }),
      )
      .default([]),
  })
  .prefault({});

export type LootRarity = z.infer<typeof LootRaritySchema>;
export type LootSettings = z.infer<typeof LootSettingsSchema>;
