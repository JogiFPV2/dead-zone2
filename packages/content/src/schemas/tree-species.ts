import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  FractionSchema,
  I18nKeySchema,
  NumberRangeSchema,
  TagListSchema,
} from './common/index.js';

/** Typ ulistnienia: liściaste (kępy liści) albo iglaste (gałęzie z igłami). */
export const LEAF_TYPES = ['broadleaf', 'conifer'] as const;
export type LeafType = (typeof LEAF_TYPES)[number];

/** Sezony kolorów korony. */
export const TREE_SEASONS = ['summer', 'autumn', 'winter'] as const;
export type TreeSeason = (typeof TREE_SEASONS)[number];

/**
 * Gdzie generator mapy sadzi drzewo (odpowiada klasom drzew w `tools/map`):
 * `forest` = las (klasa rastra 1), `park` = park / zieleń (klasa 2), `street` = aleje i szpalery
 * (`treeRows`, `TreeLine.kind='avenue'`), `field` = miedze (`TreeLine.kind='balk'`),
 * `garden` = ogrody i działki przy domach.
 */
export const TREE_HABITATS = ['forest', 'park', 'street', 'field', 'garden'] as const;
export type TreeHabitat = (typeof TREE_HABITATS)[number];

export const DEFAULT_TREE_CROWN_DENSITY = 0.7;
export const DEFAULT_TREE_LEAF_CLUSTERS = { min: 8, max: 14 } as const;
export const DEFAULT_TREE_WIND_SWAY = { amplitude: 0.05, frequencyHz: 0.4 } as const;

const HexSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'kolor w postaci #rrggbb (małe litery)');

/** Kolor z wagą losowania (per drzewo, deterministycznie z seedu). */
export const WeightedColorSchema = z.strictObject({
  hex: HexSchema,
  weight: z.number().positive().default(1),
});

/** Lista kolorów korony w sezonie; pusta lista = brak liści (np. dąb zimą). */
const SeasonColorsSchema = z.array(WeightedColorSchema);

export const TreeColorsSchema = z.strictObject({
  summer: SeasonColorsSchema.min(1),
  autumn: SeasonColorsSchema.min(1),
  winter: SeasonColorsSchema.default([]),
});

export const TreeTrunkSchema = z.strictObject({
  radiusM: z.number().positive().max(2),
  /** Kolor kory (fallback bez tekstury). */
  color: HexSchema.default('#5a4636'),
  /** Tekstura kory PBR (np. ambientCG `Bark007`); brak = sam kolor. */
  barkTexture: z.string().min(1).optional(),
});

export const TreeWindSwaySchema = z.strictObject({
  /** Wychylenie wierzchołka jako ułamek wysokości. */
  amplitude: z.number().min(0).max(0.3),
  frequencyHz: z.number().positive().max(3),
});

/**
 * Gatunek drzewa / krzewu do realistycznego renderu (`?style=real`): wymiary, korona z
 * półprzezroczystych kęp liści, kora, kolory sezonowe i wagi sadzenia per siedlisko.
 */
export const TreeSpeciesSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  tags: TagListSchema,
  leafType: z.enum(LEAF_TYPES),
  /** Krzew (niski, bez wyraźnego pnia). */
  shrub: z.boolean().default(false),
  heightM: NumberRangeSchema,
  crownRadiusM: NumberRangeSchema,
  /** Gęstość korony 0..1 (ile światła przepuszcza, przezroczystość kęp). */
  crownDensity: FractionSchema.default(DEFAULT_TREE_CROWN_DENSITY),
  /** Liczba kęp liści w koronie. */
  leafClusters: z
    .strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) })
    .refine((r) => r.min <= r.max, { message: 'min nie może być większe niż max', path: ['max'] })
    .default(DEFAULT_TREE_LEAF_CLUSTERS),
  trunk: TreeTrunkSchema,
  colors: TreeColorsSchema,
  /** Waga sadzenia per siedlisko; brak klucza = gatunek tam nie rośnie. */
  habitats: z.partialRecord(z.enum(TREE_HABITATS), z.number().min(0)).default({}),
  windSway: TreeWindSwaySchema.default(DEFAULT_TREE_WIND_SWAY),
  model: z.string().optional(),
  ext: ExtSchema,
});

export type TreeSpecies = z.infer<typeof TreeSpeciesSchema>;
export type WeightedColor = z.infer<typeof WeightedColorSchema>;
