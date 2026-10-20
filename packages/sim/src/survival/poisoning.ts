import type { SimWorld } from '../core/world.js';
import { ModSlot } from '../content/adapter.js';
import { clampStat, modded, type SurvivalWorld } from './state.js';

/**
 * Food poisoning from tainted water (docs 9.60): drinking a drink with
 * `drink.perUse.sicknessChance` (the dirty-water bottle) or tainted water straight from a tank
 * rolls `w.rng.health` with that chance × the `food-sickness-chance` modifier (traits). A hit adds
 * `dose` to the pending load (`SurvivalWorld.poisonLoad`); every game minute up to
 * `risePerHour / 60` of it moves into `poison`, which then recovers by `recoverPerHour / 60`.
 * The `sickness` stat (moodle `base:sick`) = max(zombie virus sickness, `poison`). From
 * `nauseaFrom` the player gets unhappier (nausea); from `healthLossFrom` it costs health, but
 * never below `minHealth` (there is no death cause for poisoning in the protocol yet).
 * Boiling (`base:boil-water`: dirty → clean bottle) purifies the water.
 * Values: `worldSettings.water.poisoning` when the content has it, else `POISONING`.
 */
export interface PoisoningSettings {
  /** Chance per drink of tainted tank water when the tainted bottle has no `sicknessChance`. */
  taintedChance: number;
  /** Sickness added by one poisoning (spread over time). */
  dose: number;
  risePerHour: number;
  recoverPerHour: number;
  nauseaFrom: number;
  unhappinessPerHour: number;
  healthLossFrom: number;
  healthLossPerMin: number;
  minHealth: number;
}

/** Fallback in the style of Project Zomboid: a sip of tainted water is a real risk, a day ill. */
export const POISONING: PoisoningSettings = {
  taintedChance: 0.4,
  dose: 35,
  risePerHour: 20,
  recoverPerHour: 4,
  nauseaFrom: 20,
  unhappinessPerHour: 4,
  healthLossFrom: 70,
  healthLossPerMin: 0.02,
  minHealth: 10,
};

export function poisoningSettings(s: SurvivalWorld): PoisoningSettings {
  const ws = s.content.water as { poisoning?: Partial<PoisoningSettings> } | undefined;
  return { ...POISONING, ...ws?.poisoning };
}

/** Rolls a poisoning for `chance` (before the trait modifier); true on a hit. */
export function rollPoisoning(w: SimWorld, eid: number, chance: number): boolean {
  const s = w.survival;
  if (!s || !(chance > 0) || s.dead[eid]) return false;
  const p = Math.min(1, chance * modded(s, eid, ModSlot['food-sickness-chance'], 1));
  if (p <= 0 || !w.rng.health.chance(p)) return false;
  const cfg = poisoningSettings(s);
  s.poisonLoad[eid] = Math.fround(Math.min(100, (s.poisonLoad[eid] ?? 0) + cfg.dose));
  return true;
}

/**
 * Spoiled food and medicine (docs 9.66). Content has no such fields yet; when it adds
 * `food.spoiledSicknessChance` / `food.spoiledPoisonLoad` / `medicine {reduceSickness,
 * durationMin}` they win over these fallbacks.
 */
export const SPOILED_SICKNESS_CHANCE = 0.25;
export const SPOILED_POISON_LOAD = 15;
export const MEDICINE_REDUCE_SICKNESS = 30;
export const MEDICINE_DURATION_MIN = 60;

const num = (v: unknown, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;

/** Rotten food was eaten: chance of a smaller poisoning (load `spoiledPoisonLoad`). */
export function rollSpoiledFood(w: SimWorld, eid: number, food: unknown): boolean {
  const s = w.survival;
  const f = (food ?? {}) as { spoiledSicknessChance?: unknown; spoiledPoisonLoad?: unknown };
  const chance = num(f.spoiledSicknessChance, SPOILED_SICKNESS_CHANCE);
  if (!s || !(chance > 0) || s.dead[eid]) return false;
  const p = Math.min(1, chance * modded(s, eid, ModSlot['food-sickness-chance'], 1));
  if (p <= 0 || !w.rng.health.chance(p)) return false;
  const load = num(f.spoiledPoisonLoad, SPOILED_POISON_LOAD);
  s.poisonLoad[eid] = Math.fround(Math.min(100, (s.poisonLoad[eid] ?? 0) + load));
  return true;
}

/**
 * Takes a dose of medicine: `reduceSickness` (for `reduce_sickness` items without a `medicine`
 * block scaled by `potency / 0.5`) spread over `durationMin`. Doses stack.
 */
export function takeMedicine(
  s: SurvivalWorld,
  eid: number,
  medicine: unknown,
  potency?: number,
): void {
  const m = (medicine ?? {}) as { reduceSickness?: unknown; durationMin?: unknown };
  let amount = num(m.reduceSickness, MEDICINE_REDUCE_SICKNESS);
  if (m.reduceSickness === undefined && potency !== undefined) amount *= potency / 0.5;
  const dur = Math.max(1, num(m.durationMin, MEDICINE_DURATION_MIN));
  if (!(amount > 0)) return;
  const total = (s.medicine[eid] ?? 0) + amount;
  s.medicine[eid] = Math.fround(total);
  s.medicineRate[eid] = Math.fround(Math.max(s.medicineRate[eid] ?? 0, total / dur));
}

/**
 * One game minute of poisoning (health step, after the virus): load → poison → recovery,
 * `sickness`, nausea; returns the health to lose this minute (already capped at `minHealth`).
 */
export function poisonMinute(s: SurvivalWorld, eid: number, virusSickness: number): number {
  let med = s.medicine[eid] ?? 0;
  if (med > 0) {
    // Medicine: lowers the pending load first, then the sickness itself.
    let r = Math.min(med, s.medicineRate[eid] ?? 0);
    med -= r;
    const l = s.poisonLoad[eid] ?? 0;
    const fromLoad = Math.min(l, r);
    s.poisonLoad[eid] = Math.fround(l - fromLoad);
    r -= fromLoad;
    if (r > 0) s.poison[eid] = Math.fround(Math.max(0, (s.poison[eid] ?? 0) - r));
    s.medicine[eid] = med > 1e-4 ? Math.fround(med) : 0;
    if (!s.medicine[eid]) s.medicineRate[eid] = 0;
  }
  const load = s.poisonLoad[eid] ?? 0;
  const before = s.poison[eid] ?? 0;
  if (load <= 0 && before <= 0) {
    if (med > 0) s.vitals.sickness[eid] = clampStat(virusSickness);
    return 0;
  }
  const cfg = poisoningSettings(s);
  let poison = before;
  if (load > 0) {
    const step = Math.min(load, cfg.risePerHour / 60);
    s.poisonLoad[eid] = Math.fround(load - step);
    poison = Math.min(100, poison + step);
  } else poison = Math.max(0, poison - cfg.recoverPerHour / 60);
  s.poison[eid] = Math.fround(poison);
  const v = s.vitals;
  v.sickness[eid] = clampStat(Math.max(virusSickness, s.poison[eid] ?? 0));
  if (poison >= cfg.nauseaFrom)
    v.unhappiness[eid] = clampStat((v.unhappiness[eid] ?? 0) + cfg.unhappinessPerHour / 60);
  if (poison < cfg.healthLossFrom) return 0;
  const hp = v.health[eid] ?? 0;
  return hp > cfg.minHealth ? Math.min(cfg.healthLossPerMin, hp - cfg.minHealth) : 0;
}
