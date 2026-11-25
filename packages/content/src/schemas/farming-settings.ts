import { z } from 'zod';
import { GameMinutesSchema, ItemRefSchema, SkillRefSchema, TagSchema } from './common/index.js';

/**
 * Jedna roślina uprawna: czym ją sadzić (`plant`: torebka nasion, sadzeniak), co daje zbiór
 * (`harvest`, `yield` sztuk przed premią z Rolnictwa) i ile dób gry rośnie (`growDays`, liczone
 * tylko wtedy, gdy ziemia jest wilgotna).
 */
export const CropSchema = z.strictObject({
  id: z.string().min(1),
  /** Przedmioty, z których się ją sadzi (jedna sztuka na grządkę). */
  plant: z.array(ItemRefSchema).min(1),
  harvest: ItemRefSchema,
  yield: z.strictObject({
    min: z.number().int().min(1).max(50),
    max: z.number().int().min(1).max(50),
  }),
  growDays: z.number().positive().max(60),
});

export type Crop = z.infer<typeof CropSchema>;

/**
 * Uprawa (Symulacja, docs 9.86): przekopanie kafla trawy / ziemi narzędziem z tagiem `digTag`
 * (motyka, grabie, łopata) trzymanym w ręce, sadzenie, podlewanie wodą z naczynia
 * (`item.waterVessel`), wzrost w czasie i zbiór. Pusta lista `crops` = uprawa wyłączona.
 */
export const FarmingSettingsSchema = z
  .strictObject({
    /** Tag narzędzia, którym się przekopuje (trzymanego w ręce). */
    digTag: TagSchema.default('base:tool-dig'),
    /** Kafle podłogi (na zewnątrz), które da się przekopać. */
    soilFloors: z.array(z.string()).default(['base:grass', 'base:dirt']),
    digMin: GameMinutesSchema.default(20),
    plantMin: GameMinutesSchema.default(5),
    waterMin: GameMinutesSchema.default(1),
    harvestMin: GameMinutesSchema.default(5),
    clearMin: GameMinutesSchema.default(5),
    /** Napełnianie naczynia przy kranie, prysznicu, wannie, zbiorniku albo w wodzie. */
    fillMin: GameMinutesSchema.default(0.5),
    /** Litry wody na jedno podlanie grządki. */
    waterPerPlotL: z.number().positive().max(20).default(0.25),
    /** Ziemia jest wilgotna (roślina rośnie) tyle minut po podlaniu albo deszczu. */
    moistMin: GameMinutesSchema.default(1440),
    /** Bez wody od tylu minut od ostatniego podlania roślina więdnie (nie rośnie). */
    wiltMin: GameMinutesSchema.default(2880),
    /** Bez wody od tylu minut roślina usycha. */
    dieMin: GameMinutesSchema.default(5760),
    /** Sezon (dzień roku 1..365, włącznie): poza nim nie da się sadzić, a rośliny giną. */
    season: z
      .strictObject({
        fromDay: z.number().int().min(1).max(365),
        toDay: z.number().int().min(1).max(365),
      })
      .default({ fromDay: 91, toDay: 304 }),
    /** Temperatura powietrza (°C), przy której roślina zamarza. */
    frostC: z.number().default(0),
    /** Pokrywa śniegu (0..1), przy której roślina ginie. */
    snowKill: z.number().min(0).max(1).default(0.2),
    skill: SkillRefSchema.default('base:farming'),
    /** Dodatkowe sztuki plonu na poziom umiejętności (część ułamkowa losowana). */
    yieldPerLevel: z.number().min(0).max(5).default(0.25),
    xp: z
      .strictObject({
        dig: z.number().min(0).default(1),
        plant: z.number().min(0).default(1),
        water: z.number().min(0).default(0.5),
        harvest: z.number().min(0).default(5),
      })
      .prefault({}),
    crops: z.array(CropSchema).default([]),
  })
  .prefault({});

export type FarmingSettings = z.infer<typeof FarmingSettingsSchema>;
