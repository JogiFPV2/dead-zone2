import { z } from 'zod';
import {
  FractionSchema,
  ItemRefSchema,
  NoiseSchema,
  SkillRefSchema,
  TagSchema,
} from './common/index.js';

const HpSchema = z.number().min(1).max(10000);
/** Czas akcji w sekundach rzeczywistych przy ×1 (20 ticków / s). */
const SecSchema = z.number().min(0.05).max(600);

/** Barykady z desek (PZ): młotek + deska + gwoździe, deski zbijane po kolei. */
export const BarricadeSettingsSchema = z
  .strictObject({
    /** Najwięcej desek na jednej krawędzi. */
    maxPlanks: z.number().int().min(1).max(8).default(4),
    /** Wytrzymałość jednej deski (dolicza się do hp krawędzi; zombie zbijają je po kolei). */
    plankHp: HpSchema.default(40),
    /** Przedmiot deski (zużywany przy przybiciu, zwracany przy zdjęciu). */
    plankItem: ItemRefSchema.default('base:plank'),
    /** Przedmiot gwoździ i ile na deskę. */
    nailsItem: ItemRefSchema.default('base:nails'),
    nailsPerPlank: z.number().int().min(0).max(20).default(2),
    /** Tag młotka (wymagany do przybicia, wystarcza do zdjęcia). */
    hammerTag: TagSchema.default('base:tool-hammer'),
    /** Tag łomu (zdejmowanie desek, wyważanie drzwi). */
    pryTag: TagSchema.default('base:tool-pry'),
    /** Czas przybicia jednej deski (s). */
    addSec: SecSchema.default(4),
    /** Czas zdjęcia jednej deski (s). */
    removeSec: SecSchema.default(3),
    /** Krótszy czas za każdy poziom Carpentry: × (1 − poziom × to), nie mniej niż × `minTimeMul`. */
    carpentryTimePerLevel: FractionSchema.default(0.06),
    minTimeMul: FractionSchema.default(0.4),
    /** Umiejętność i XP za przybicie / zdjęcie deski. */
    skill: SkillRefSchema.default('base:carpentry'),
    xpPerPlank: z.number().min(0).max(1000).default(3),
    xpPerRemove: z.number().min(0).max(1000).default(1),
    /** Szansa odzyskania każdego gwoździa przy zdjęciu deski. */
    nailReturnChance: FractionSchema.default(0.5),
    /** Od tylu desek okno / brama nie przepuszcza wzroku (drzwi zawsze blokują). */
    sightBlockPlanks: z.number().int().min(1).max(8).default(2),
    /** Hałas wbijania gwoździ (na starcie akcji). */
    noise: NoiseSchema.default({ radiusTiles: 15, volume: 0.7 }),
  })
  .prefault({});

/** Rozbijanie szyby, przechodzenie przez okno i usuwanie szkła. */
export const WindowActionsSettingsSchema = z
  .strictObject({
    /** Czas rozbicia szyby (`smashWindow`). */
    smashSec: SecSchema.default(1),
    /** Gołą ręką (nic w `hand_primary`): szansa skaleczenia dłoni (`laceration`). */
    handCutChance: FractionSchema.default(0.5),
    /** Czas usunięcia odłamków z ramy (`removeGlass`). */
    removeGlassSec: SecSchema.default(3),
    /** Co zostaje po `removeGlass` (do ekwipunku, za ciężkie → na ziemię); brak w danych = nic. */
    glassItem: ItemRefSchema.default('base:glass-shards'),
    glassPieces: z.number().int().min(0).max(20).default(1),
    /**
     * Przejście przez zbite okno z odłamkami: z szansą fizyki `vault.glassChance` rana; tyle z
     * nich to `laceration`, reszta `scratch`.
     */
    climbLacerationShare: FractionSchema.default(0.4),
  })
  .prefault({});

/** Wyważanie zamkniętych na klucz drzwi / bram (`forceDoor`). Klucze: TODO. */
export const ForceSettingsSchema = z
  .strictObject({
    /** Łomem (tag `barricade.pryTag`): czas, szansa, hałas. */
    prySec: SecSchema.default(3),
    pryChance: FractionSchema.default(0.4),
    pryNoise: NoiseSchema.default({ radiusTiles: 10, volume: 0.5 }),
    /** Kopniakiem (bez łomu). */
    kickSec: SecSchema.default(1.2),
    kickChance: FractionSchema.default(0.15),
    kickNoise: NoiseSchema.default({ radiusTiles: 16, volume: 0.8 }),
    /** + szansy za każdy poziom Strength. */
    chancePerStrength: FractionSchema.default(0.03),
    strengthSkill: SkillRefSchema.default('base:strength'),
    /** Nieudana próba: obrażenia drzwi (przy 0 hp → `broken`). */
    failDamage: z.number().min(0).max(10000).default(8),
  })
  .prefault({});
