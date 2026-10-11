import { z } from 'zod';
import { SkillRefSchema, TagSchema } from '../common/index.js';
import { frac, minutes, num, stat } from './num.js';

/**
 * Odkażanie rany (etap 3 mebli i czynności): środek z efektem `disinfect` (woda utleniona,
 * jałowy opatrunek) albo płyn z tagiem `liquidTag` (wódka). Leczy zakażenie brudem, chroni ranę
 * przed nowym zakażeniem przez `protectMin` i przyspiesza gojenie o `healBonus` × siła środka.
 */
export const DisinfectSettingsSchema = z
  .strictObject({
    /** Płyn odkażający spoza apteczki; zużywa jedno użycie (łyk). */
    liquidTag: TagSchema.default('base:disinfectant-liquid'),
    /** Siła płynu z `liquidTag` (środek medyczny ma własne `potency`). */
    liquidPotency: frac(0.5),
    /** Bez nowego zakażenia brudem przez tyle minut gry po odkażeniu. */
    protectMin: minutes(720),
    /** Rana goi się od razu o `healBonus` × siła (woda utleniona „zmniejsza ranę”). */
    healBonus: frac(0.1),
    /** Szczypie: chwilowy ból dodany do statystyki bólu (0 = bez). */
    painAdd: stat(10),
    /** Czas w minutach gry. */
    min: minutes(1),
    skill: SkillRefSchema.default('base:first-aid'),
    xp: num(1, 100),
  })
  .prefault({});

/** Szycie rany igłą (`needleTag`) i nicią (`threadTag`, zużywa 1). */
export const StitchSettingsSchema = z
  .strictObject({
    kinds: z
      .array(z.enum(['scratch', 'laceration', 'bite', 'deep']))
      .default(['laceration', 'bite', 'deep']),
    needleTag: TagSchema.default('base:tool-needle'),
    threadTag: TagSchema.default('base:thread'),
    min: minutes(8),
    /** Szansa powodzenia: `chance` + `chancePerLevel` × poziom `skill` (najwyżej 0,95). */
    chance: frac(0.6),
    chancePerLevel: frac(0.05),
    skill: SkillRefSchema.default('base:first-aid'),
    /** Zszyta rana: krwawienie × `bleedingMul`, gojenie × `healMul`. */
    bleedingMul: frac(0.1),
    healMul: num(2, 10),
    /** Nieudane szycie: tyle bólu i nić zużyta. */
    failPain: stat(20),
    xp: num(3, 100),
  })
  .prefault({});
