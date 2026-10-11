import { z } from 'zod';

const shutoff = (min: number, max: number) =>
  z
    .strictObject({
      /** false = media nigdy się nie wyłączają. */
      enabled: z.boolean().default(true),
      /** Wyłączenie po N dniach od dnia startu świata, losowo w zakresie (jak PZ, 0 = od razu). */
      offAfterDays: z
        .strictObject({
          min: z.number().int().min(0).max(3650),
          max: z.number().int().min(0).max(3650),
        })
        .refine((r) => r.max >= r.min, { message: 'max < min' })
        .default({ min, max }),
    })
    .default({ enabled: true, offAfterDays: { min, max } });

/**
 * Media miejskie (Symulacja, docs/sim-architecture.md „Meble i czynności”): prąd z sieci (lodówki,
 * zamrażarki, telewizory, kuchenki elektryczne, dystrybutory) i woda w kranach. Każde wyłącza
 * się raz, w dniu wylosowanym z ziarna świata w zakresie `offAfterDays`. Generatory później.
 */
const FREEZER_DEFAULTS = { freezeAfterMin: 360, thawMin: 720, frozenSpoilageMultiplier: 0.05 };

/**
 * Mrożenie (schowek kategorii `freezer` z prądem): jedzenie zamarza po `freezeAfterMin` minutach
 * gry. Wyjęte albo po zaniku prądu rozmraża się przez `thawMin` minut, psując się w tym czasie
 * z mnożnikiem `frozenSpoilageMultiplier`, potem normalnie.
 */
const FreezerSchema = z
  .strictObject({
    freezeAfterMin: z.number().int().min(0).max(10080).default(FREEZER_DEFAULTS.freezeAfterMin),
    thawMin: z.number().int().min(0).max(10080).default(FREEZER_DEFAULTS.thawMin),
    frozenSpoilageMultiplier: z
      .number()
      .min(0)
      .max(1)
      .default(FREEZER_DEFAULTS.frozenSpoilageMultiplier),
  })
  .default(FREEZER_DEFAULTS);

export const UtilitiesSettingsSchema = z
  .strictObject({
    power: shutoff(7, 30),
    water: shutoff(7, 30),
    freezer: FreezerSchema,
  })
  .default({
    power: { enabled: true, offAfterDays: { min: 7, max: 30 } },
    water: { enabled: true, offAfterDays: { min: 7, max: 30 } },
    freezer: FREEZER_DEFAULTS,
  });

export type UtilitiesSettings = z.infer<typeof UtilitiesSettingsSchema>;
