import { z } from 'zod';
import { LockKindSchema } from './building-kind.js';
import { FractionSchema, NoiseSchema, SkillRefSchema, TagSchema } from './common/index.js';

/** Czas akcji w sekundach rzeczywistych przy ×1 (20 ticków / s). */
const SecSchema = z.number().min(0.05).max(600);

/**
 * Zamki drzwi (protokół 24): klucze do budynku, wytrychy, pukanie. Drzwi zewnętrzne (z jednej
 * strony pomieszczenie, z drugiej dwór) są na starcie zamknięte na klucz z szansą
 * `exteriorLockedChance` (losowanie z ziarna świata per drzwi), chyba że generator podał
 * `SimChunk.lockedDoors`. Od środka budynku zamek otwiera się i zamyka bez klucza.
 */
export const LocksSettingsSchema = z
  .strictObject({
    exteriorLockedChance: FractionSchema.default(0),
    /**
     * Szansa zamka per rodzaj budynku (`BUILDING_KINDS` z generatora) albo `gate` (brama w
     * ogrodzeniu). Rodzaj spoza mapy dostaje `exteriorLockedChance`. Odczyt: `exteriorLockedChanceFor`.
     */
    exteriorLockedChanceByBuilding: z.partialRecord(LockKindSchema, FractionSchema).optional(),
    /** Tag klucza do budynku (przedmiot z `buildingId` w stanie gry). */
    keyTag: TagSchema.default('base:building-key'),
    /** Czas otwarcia / zamknięcia kluczem (s). */
    keySec: SecSchema.default(2),
    /**
     * Klucz w łupach zwłok zombie (`buildingKey` tabeli): budynek najbliższy miejscu śmierci,
     * najdalej tyle kafli.
     */
    corpseKeyRadiusTiles: z.number().int().min(0).max(256).default(24),
    lockpick: z
      .strictObject({
        /** Tag wytrycha (spinka, widelec). */
        tag: TagSchema.default('base:lockpick'),
        sec: SecSchema.default(8),
        /** Szansa powodzenia + za poziom umiejętności `skill` (najwyżej 0,95). */
        chance: FractionSchema.default(0.25),
        chancePerLevel: FractionSchema.default(0.06),
        skill: SkillRefSchema.default('base:nimble'),
        /** Szansa złamania wytrycha przy nieudanej próbie. */
        breakChance: FractionSchema.default(0.35),
        xp: z.number().min(0).max(1000).default(2),
        noise: NoiseSchema.default({ radiusTiles: 2, volume: 0.15 }),
      })
      .prefault({}),
    /** Pukanie: hałas (zombie słyszą), natychmiast. */
    knockNoise: NoiseSchema.default({ radiusTiles: 6, volume: 0.4 }),
  })
  .prefault({});
export type LocksSettings = z.infer<typeof LocksSettingsSchema>;
