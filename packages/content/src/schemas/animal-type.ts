import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  FractionSchema,
  I18nKeySchema,
  IntRangeSchema,
  ItemRefSchema,
  NoiseSchema,
  RealSecondsSchema,
  TagListSchema,
  TilesSchema,
} from './common/index.js';

/** Gdzie zwierzę żyje: `town` = chunki z budynkami, `wild` = chunki bez budynków, `any` = wszędzie. */
export const ANIMAL_HABITATS = ['town', 'wild', 'any'] as const;
export type AnimalHabitat = (typeof ANIMAL_HABITATS)[number];

/** Przedmiot zostawiany przez zabite zwierzę (kupka na ziemi w miejscu zwłok). */
export const AnimalLootSchema = z.strictObject({
  item: ItemRefSchema,
  count: IntRangeSchema.default({ min: 1, max: 1 }),
  chance: FractionSchema.default(1),
});

/**
 * Typ zwierzęcia (sim `animals/*`): wędruje / pasie się, ucieka przed graczem (wzrok, słuch) i
 * zombie, można na nie polować bronią (wręcz i palną). Prędkości w kaflach na sekundę czasu
 * rzeczywistego, zasięgi w kaflach.
 */
export const AnimalTypeSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  tags: TagListSchema,
  health: z.number().positive(),
  speed: z.strictObject({
    wanderTilesPerSec: z.number().min(0),
    fleeTilesPerSec: z.number().min(0),
  }),
  /** Promień kolizji (kafle). */
  radiusTiles: z.number().min(0.05).max(0.6).default(0.25),
  sightRangeTiles: TilesSchema,
  hearingRangeTiles: TilesSchema,
  /** Gracz (widziany) bliżej niż ten dystans płoszy zwierzę. */
  fleeDistanceTiles: TilesSchema,
  /** Ucieczka trwa, aż zagrożenie jest dalej niż ten dystans (i minie `fleeMinSec`). */
  safeDistanceTiles: TilesSchema,
  /** Minimalny czas ucieczki po spłoszeniu. */
  fleeMinSec: RealSecondsSchema.default(3),
  /** Płoszy się na widok zombie (w zasięgu `fleeDistanceTiles`). */
  fearsZombies: z.boolean().default(true),
  /** Ptak: po spłoszeniu odlatuje i znika po `despawnAfterFleeSec`. */
  fliesAway: z.boolean().default(false),
  despawnAfterFleeSec: RealSecondsSchema.default(2),
  /** Hałas przy ucieczce (pies szczeka: przyciąga zombie); brak = cicho. */
  fleeNoise: NoiseSchema.optional(),
  /** Zwierzyna łowna (UI, statystyki); polować da się na każde zwierzę. */
  huntable: z.boolean().default(false),
  habitat: z.enum(ANIMAL_HABITATS).default('any'),
  /** Waga przy losowaniu typu w spawnie mapy. */
  spawnWeight: z.number().min(0).default(1),
  /** Promień wędrówki wokół miejsca spawnu i przerwy między celami (pasienie). */
  wanderRadiusTiles: TilesSchema.default(6),
  grazeSec: z
    .strictObject({ min: RealSecondsSchema, max: RealSecondsSchema })
    .refine((r) => r.min <= r.max, { message: 'min nie może być większe niż max', path: ['max'] })
    .default({ min: 3, max: 10 }),
  loot: z.array(AnimalLootSchema).default([]),
  model: z.string().optional(),
  ext: ExtSchema,
});

export type AnimalType = z.infer<typeof AnimalTypeSchema>;
