import { z } from 'zod';
import {
  CapacityKgSchema,
  ContainerTypeRefSchema,
  ContentIdSchema,
  GameMinutesSchema,
  ExtSchema,
  FootprintSchema,
  I18nKeySchema,
  ItemRefSchema,
  LootTableRefSchema,
  RoomTypeSchema,
  SurfaceHeightMSchema,
  TagListSchema,
} from './common/index.js';
import { LootCategorySchema } from './loot-category.js';

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
  /**
   * Mnożnik szybkości psucia (lodówka 0.3, zamrażarka 0.05). Przy `requiresPower` działa tylko
   * z prądem; bez prądu jedzenie psuje się normalnie (×1).
   */
  spoilageMultiplier: z.number().min(0).max(1).default(1),
  requiresPower: z.boolean().default(false),
  /** Czas akcji „Przeszukaj” w minutach gry; brak = `worldSettings.loot.search.searchSec`. */
  searchMin: GameMinutesSchema.optional(),
  /** Gracz może go podnieść i przenieść (jako ten przedmiot). */
  pickupItem: ItemRefSchema.optional(),
  /**
   * Własna tabela łupów schowka (lodówka → jedzenie i napoje). Wygrywa z ogólną tabelą
   * pomieszczenia; pomieszczenie może ją podmienić tylko tabelą, która wymienia ten typ
   * w `containers` (`lootTableForContainer`).
   */
  defaultLootTable: LootTableRefSchema.optional(),
  /**
   * Kategorie przedmiotów, które realnie leżą w tym schowku (`LootCategory`); test paczki nie
   * przepuści tabeli, która wkłada tu coś spoza listy. Brak = bez ograniczeń (np. mody).
   * Dotyczy tylko lootu: gracz może włożyć do schowka cokolwiek.
   */
  lootAccepts: z.array(LootCategorySchema).optional(),
  /**
   * Typy pomieszczeń, w których ten schowek zwykle stoi (szafa → sypialnia). Test paczki sprawdza
   * loot na obu osiach: kategoria musi pasować do schowka i do `worldSettings.loot.roomAccepts`
   * każdego z tych pomieszczeń. Brak = bez osi pomieszczenia (schowki na dworze, w autach).
   */
  placeIn: z.array(RoomTypeSchema).optional(),
  /**
   * Dodatkowe schowki tego samego mebla (lodówka z zamrażarką: `base:fridge-freezer` +
   * `["base:freezer"]`). Mapa stawia jeden obiekt; sim tworzy schowek tego typu i po jednym
   * na każdą przegrodę, każdy z własną tabelą, `lootAccepts` i psuciem. Przegroda nie ma
   * własnych przegród.
   */
  compartments: z.array(ContainerTypeRefSchema).optional(),
  /** Zajmowane kafle przy `rot = 0` (`footprintOf`); brak = 1×1. */
  footprint: FootprintSchema.optional(),
  /** Wysokość blatu (m), na którym stoi mebel z `placeable.onSurface` (szafka RTV 0.55, biurko 0.75). */
  surfaceHeightM: SurfaceHeightMSchema.optional(),
  model: z.string().optional(),
  ext: ExtSchema,
});

export type ContainerType = z.infer<typeof ContainerTypeSchema>;
