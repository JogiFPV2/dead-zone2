import { z } from 'zod';
import {
  ContainerTypeRefSchema,
  FractionSchema,
  ItemRefSchema,
  NoiseSchema,
  SkillRefSchema,
  TilesSchema,
} from './common/index.js';
import { FuelSettingsSchema, RepairSettingsSchema } from './vehicles-repair-settings.js';
import { VehicleSpawnSettingsSchema } from './vehicles-spawn-settings.js';

/** Czas akcji w sekundach rzeczywistych przy ×1 (20 ticków / s); 0 = natychmiast. */
const SecSchema = z.number().min(0).max(600);
const XpSchema = z.number().min(0).max(1000);
const SkillLevel = z.number().int().min(0).max(10);

/** Klakson: głośny hałas (zombie słyszą z daleka), najwyżej raz na `cooldownSec`. */
export const HornSettingsSchema = z
  .strictObject({
    noise: NoiseSchema.default({ radiusTiles: 45, volume: 1 }),
    cooldownSec: SecSchema.default(0.5),
  })
  .prefault({});

/**
 * Odpalanie na kable (PZ hotwire): z fotela kierowcy, bez kluczyka. Szansa na próbę =
 * `baseChance` + poziom Electrical × `chancePerElectrical` + poziom Mechanics ×
 * `chancePerMechanics`, najwyżej `maxChance`. Wymaga minimalnych poziomów obu umiejętności.
 */
export const HotwireSettingsSchema = z
  .strictObject({
    sec: SecSchema.default(6),
    electricalSkill: SkillRefSchema.default('base:electrical'),
    mechanicsSkill: SkillRefSchema.default('base:mechanics'),
    minElectrical: SkillLevel.default(1),
    minMechanics: SkillLevel.default(0),
    baseChance: FractionSchema.default(0.2),
    chancePerElectrical: FractionSchema.default(0.1),
    chancePerMechanics: FractionSchema.default(0.05),
    maxChance: FractionSchema.default(0.95),
    /** Hałas grzebania pod kierownicą (na starcie akcji). */
    noise: NoiseSchema.default({ radiusTiles: 6, volume: 0.35 }),
    /** XP za próbę (udaną i nieudaną) w Electrical. */
    xp: XpSchema.default(4),
  })
  .prefault({});

/**
 * Rozgrywka pojazdów (Symulacja, docs/sim-architecture.md „Pojazdy — rozgrywka”): wsiadanie i
 * wysiadanie jako akcje czasowe, zamki i kluczyki, bagażnik i schowek, klakson, kable.
 */
export const VehiclesSettingsSchema = z
  .strictObject({
    /** Czas wsiadania / wysiadania (s; 0 = natychmiast, bez akcji). */
    enterSec: SecSchema.default(1.5),
    exitSec: SecSchema.default(1),
    /** Przedmiot kluczyka (pasuje tylko do jednego auta). */
    keyItem: ItemRefSchema.default('base:car-key'),
    /** Typy schowków bagażnika i schowka (czas przeszukania, domyślna tabela łupów). */
    trunkContainer: ContainerTypeRefSchema.default('base:car-trunk'),
    gloveboxContainer: ContainerTypeRefSchema.default('base:car-glovebox'),
    /** Zasięg do punktu bagażnika (za tyłem auta). */
    trunkReachTiles: TilesSchema.default(1.5),
    horn: HornSettingsSchema,
    hotwire: HotwireSettingsSchema,
    fuel: FuelSettingsSchema,
    repair: RepairSettingsSchema,
    spawn: VehicleSpawnSettingsSchema,
  })
  .prefault({});

export type VehiclesSettings = z.infer<typeof VehiclesSettingsSchema>;
