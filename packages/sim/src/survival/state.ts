import { BODY_PARTS, WOUND_KINDS, type DeathCause } from '@deadzone/protocol';
import { MOD_STATS, type ContentIndex } from '../content/adapter.js';

/**
 * Survival stats kept per player (content stat ids, f32). 0–100 except `body-temperature-c` (°C)
 * and `body-weight-kg`. The order is fixed: it is the order in the state hash.
 */
export const VITAL_STATS = [
  'health',
  'hunger',
  'thirst',
  'fatigue',
  'endurance',
  'pain',
  'stress',
  'panic',
  'boredom',
  'unhappiness',
  'sickness',
  'infection',
  'wetness',
  'bleeding',
  'satiety',
  'body-temperature-c',
  'body-weight-kg',
] as const;
export type VitalStat = (typeof VITAL_STATS)[number];

export const SLEEP_SURFACES = ['floor', 'sofa', 'bed'] as const;
export type SleepSurface = (typeof SLEEP_SURFACES)[number];

export const DEATH_CAUSES: readonly DeathCause[] = [
  'bleeding',
  'starvation',
  'dehydration',
  'infection',
  'temperature',
  'wounds',
  'debug',
  'zombie',
];
export const deathCauseIndex = (c: DeathCause): number => DEATH_CAUSES.indexOf(c);

export interface Wound {
  /** Monotonic per world, defines order within a player (hash, view). */
  id: number;
  /** Index into BODY_PARTS. */
  part: number;
  /** Index into WOUND_KINDS. */
  kind: number;
  /** Game minutes since the wound was inflicted. */
  ageMin: number;
  /** Healing progress 0..1 (f32). */
  healed: number;
  bandaged: boolean;
  bandageAgeMin: number;
  /** Dirt infection (not the zombie virus). */
  dirt: boolean;
}

export const bodyPartIndex = (p: string): number => (BODY_PARTS as readonly string[]).indexOf(p);
export const woundKindIndex = (k: string): number => (WOUND_KINDS as readonly string[]).indexOf(k);

/** Survival state of a world (only when the sim got content). */
export interface SurvivalWorld {
  readonly content: ContentIndex;
  /** SoA per entity id; see VITAL_STATS. */
  readonly vitals: Record<VitalStat, Float32Array>;
  /** Energy balance in kcal since start (f32); body weight is derived from it. */
  readonly kcal: Float32Array;
  readonly dead: Uint8Array;
  /** Index into DEATH_CAUSES, set by `health` when HP reaches 0. */
  readonly cause: Uint8Array;
  readonly asleep: Uint8Array;
  /** Absolute game minute when the current sleep started. */
  readonly sleepStart: Uint32Array;
  /** Current sleep: surface (SLEEP_SURFACES index), fatigue recovered, ticks asleep, saved flag. */
  readonly sleepSurface: Uint8Array;
  readonly sleepRecovered: Float32Array;
  readonly sleepTicks: Uint32Array;
  readonly sleepSaved: Uint8Array;
  /**
   * Real time asleep in quarter-ticks (one tick adds 4 / `timeScale`: 4 at ×1, 1 at ×4), so
   * `saveAfterRealSec` means real seconds at any speed-up.
   */
  readonly sleepRealQ: Uint32Array;
  /** Host speed-up (`setTimeScale`, 1 | 2 | 4); reset to 1 by a threat. */
  timeScale: number;
  /** Wound / condition penalties per entity × 5 (survival/penalties.ts `Pen`). */
  readonly penalties: Float32Array;
  /** Zombie virus: 0/1, absolute minute of infection, incubation and death delay (minutes). */
  readonly virus: Uint8Array;
  readonly virusStart: Uint32Array;
  readonly virusIncubation: Uint32Array;
  readonly virusDeath: Uint32Array;
  /** Moodle levels, `eid * moodleCount + moodleIndex`. */
  readonly moodles: Uint8Array;
  /** Derived modifier cache (not hashed): `eid * MOD_STATS.length + slot`, mul and add. */
  readonly modMul: Float32Array;
  readonly modAdd: Float32Array;
  /** Wounds per player StableId, in wound id order. */
  readonly wounds: Map<number, Wound[]>;
  /** Stat `carry-load` (carried kg / capacity × 100), written by the inventory system. */
  readonly carryLoad: Float32Array;
  /** Speed factor of worn bags (`bag.movementPenalty` × fill), written by the inventory system. */
  readonly bagSpeed: Float32Array;
  nextWoundId: number;
  /** Last absolute game minute processed by the per-minute systems. */
  lastMinute: number;
}

export function createSurvivalWorld(
  content: ContentIndex,
  capacity: number,
  startMinute: number,
): SurvivalWorld {
  const vitals = {} as Record<VitalStat, Float32Array>;
  for (const s of VITAL_STATS) vitals[s] = new Float32Array(capacity);
  const mods = capacity * MOD_STATS.length;
  return {
    content,
    vitals,
    kcal: new Float32Array(capacity),
    dead: new Uint8Array(capacity),
    cause: new Uint8Array(capacity),
    asleep: new Uint8Array(capacity),
    sleepStart: new Uint32Array(capacity),
    sleepSurface: new Uint8Array(capacity),
    sleepRecovered: new Float32Array(capacity),
    sleepTicks: new Uint32Array(capacity),
    sleepSaved: new Uint8Array(capacity),
    sleepRealQ: new Uint32Array(capacity),
    timeScale: 1,
    penalties: new Float32Array(capacity * 5),
    virus: new Uint8Array(capacity),
    virusStart: new Uint32Array(capacity),
    virusIncubation: new Uint32Array(capacity),
    virusDeath: new Uint32Array(capacity),
    moodles: new Uint8Array(capacity * content.moodles.length),
    modMul: new Float32Array(mods).fill(1),
    modAdd: new Float32Array(mods),
    wounds: new Map(),
    carryLoad: new Float32Array(capacity),
    bagSpeed: new Float32Array(capacity).fill(1),
    nextWoundId: 1,
    lastMinute: startMinute,
  };
}

/** Starting values of a new character (from `worldSettings.survival`). */
export function initVitals(s: SurvivalWorld, eid: number): void {
  const cfg = s.content.survival;
  for (const stat of VITAL_STATS) s.vitals[stat][eid] = 0;
  s.vitals.health[eid] = 100;
  s.vitals.endurance[eid] = 100;
  s.vitals['body-temperature-c'][eid] = Math.fround(cfg.temperature.bodyBaseC);
  s.vitals['body-weight-kg'][eid] = Math.fround(cfg.nutrition.startBodyWeightKg);
  s.kcal[eid] = 0;
  s.dead[eid] = 0;
  s.asleep[eid] = 0;
  s.virus[eid] = 0;
  s.carryLoad[eid] = 0;
  s.bagSpeed[eid] = 1;
  s.penalties.fill(0, eid * 5, eid * 5 + 5);
  for (let i = 0; i < MOD_STATS.length; i++) {
    s.modMul[eid * MOD_STATS.length + i] = 1;
    s.modAdd[eid * MOD_STATS.length + i] = 0;
  }
}

/** Rate multiplied by moodle modifiers: `base × mul + add`. */
export const modded = (s: SurvivalWorld, eid: number, slot: number, base: number): number =>
  base * (s.modMul[eid * MOD_STATS.length + slot] ?? 1) +
  (s.modAdd[eid * MOD_STATS.length + slot] ?? 0);

export const clampStat = (v: number): number => Math.fround(v < 0 ? 0 : v > 100 ? 100 : v);

/** Moodle stat value (content stat id), or undefined for stats the sim does not track yet. */
export function statValue(s: SurvivalWorld, eid: number, stat: string): number | undefined {
  if (stat === 'injury') return Math.fround(100 - (s.vitals.health[eid] ?? 0));
  if (stat === 'carry-load') return s.carryLoad[eid] ?? 0;
  const arr = (s.vitals as Record<string, Float32Array | undefined>)[stat];
  return arr ? (arr[eid] ?? 0) : undefined;
}

export const moodleLevel = (s: SurvivalWorld, eid: number, index: number): number =>
  s.moodles[eid * s.content.moodles.length + index] ?? 0;
