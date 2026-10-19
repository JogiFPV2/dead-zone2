import { WOUND_KINDS } from '@deadzone/protocol';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { ModSlot } from '../content/adapter.js';
import { clampStat, deathCauseIndex, modded, type SurvivalWorld } from '../survival/state.js';
import { bandageDirty, recomputeWoundStats } from '../survival/wounds.js';
import { poisonMinute } from '../survival/poisoning.js';

/**
 * Pipeline step 12 (per game minute): wounds (ageing, clotting, dirt infection, healing), the
 * zombie virus (infection and sickness grow linearly to death), then HP: bleeding, starvation,
 * dehydration, body temperature and infected wounds hurt; regeneration only when fed, watered
 * and not bleeding.
 */
export function healthSystem(w: SimWorld, first: number, count: number): void {
  const s = w.survival;
  if (!s) return;
  for (let m = first; m < first + count; m++) {
    for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
      if (!s.dead[eid]) healthMinute(w, s, eid, m);
    }
  }
}

const DAMAGE_ORDER = ['bleeding', 'starvation', 'dehydration', 'temperature', 'wounds'] as const;

function healthMinute(w: SimWorld, s: SurvivalWorld, eid: number, minute: number): void {
  const cfg = s.content.survival;
  const v = s.vitals;
  const stableId = w.c.StableId.value[eid] ?? 0;
  const asleep = s.asleep[eid] === 1;
  const healingRate =
    modded(s, eid, ModSlot['healing-rate'], 1) * (asleep ? cfg.sleep.healingMul : 1);

  // Wounds.
  const wounds = s.wounds.get(stableId);
  let infectedWounds = 0;
  if (wounds) {
    const wc = cfg.wounds;
    for (let i = 0; i < wounds.length; i++) {
      const wd = wounds[i]!;
      wd.ageMin++;
      if (wd.bandaged) wd.bandageAgeMin++;
      const dirty = bandageDirty(wc, wd);
      const clean = wd.cleanUntilAge !== undefined && wd.ageMin < wd.cleanUntilAge;
      if (!wd.dirt && !clean) {
        const p = !wd.bandaged
          ? wc.dirtInfection.unbandagedChancePerMin
          : dirty
            ? wc.dirtInfection.dirtyBandageChancePerMin
            : 0;
        if (p > 0 && w.rng.health.chance(p)) wd.dirt = true;
      }
      if (wd.dirt) infectedWounds++;
      const t = wc.types[kindName(wd.kind)];
      const rate =
        (t.healMin > 0 ? 1 / t.healMin : 1) *
        (wd.bandaged && !dirty ? wc.bandage.healMul : 1) *
        (wd.dirt ? wc.dirtInfection.healMul : 1) *
        (wd.stitched ? wc.stitch.healMul : 1) *
        healingRate;
      wd.healed = Math.fround(Math.min(1, wd.healed + rate));
    }
    const kept = wounds.filter((wd) => wd.healed < 1);
    if (kept.length !== wounds.length) {
      wounds.length = 0;
      wounds.push(...kept);
    }
    recomputeWoundStats(s, eid, stableId);
  }

  // Zombie virus: incurable, `infection` 0 → 100 from infection to death.
  if (s.virus[eid]) {
    const elapsed = minute - (s.virusStart[eid] ?? 0);
    const deathAfter = s.virusDeath[eid] ?? 1;
    const infection = clampStat((100 * elapsed) / deathAfter);
    v.infection[eid] = infection;
    v.sickness[eid] =
      elapsed >= (s.virusIncubation[eid] ?? 0)
        ? clampStat(infection * cfg.infection.sicknessMul)
        : 0;
    if (elapsed >= deathAfter) {
      v.health[eid] = 0;
      s.cause[eid] = deathCauseIndex('infection');
      return;
    }
  }

  // Food poisoning (tainted water): sickness, nausea, health down to `minHealth` at most.
  const poisonLoss = poisonMinute(s, eid, s.virus[eid] ? (v.sickness[eid] ?? 0) : 0);
  if (poisonLoss > 0) v.health[eid] = clampStat((v.health[eid] ?? 0) - poisonLoss);

  // HP.
  const hunger = v.hunger[eid] ?? 0;
  const thirst = v.thirst[eid] ?? 0;
  const bleeding = v.bleeding[eid] ?? 0;
  const temp = v['body-temperature-c'][eid] ?? 0;
  const h = cfg.health;
  const tc = cfg.temperature;
  const damage = {
    bleeding: cfg.wounds.healthLossPerBleedingPerMin * bleeding,
    starvation: hunger >= h.starvation.fromStat ? h.starvation.healthLossPerMin : 0,
    dehydration: thirst >= h.dehydration.fromStat ? h.dehydration.healthLossPerMin : 0,
    temperature:
      temp < tc.hypothermiaBelowC || temp > tc.hyperthermiaAboveC ? tc.healthLossPerMin : 0,
    wounds: infectedWounds * cfg.wounds.dirtInfection.healthLossPerMin,
  };
  let total = 0;
  for (const k of DAMAGE_ORDER) total += damage[k];
  const regen =
    hunger <= h.regenMaxHunger && thirst <= h.regenMaxThirst && bleeding === 0
      ? h.regenPerMin * healingRate
      : 0;
  const hp = clampStat((v.health[eid] ?? 0) - total + regen);
  v.health[eid] = hp;
  if (hp <= 0) {
    let worst: (typeof DAMAGE_ORDER)[number] = 'wounds';
    let max = -1;
    for (const k of DAMAGE_ORDER) {
      if (damage[k] > max) {
        max = damage[k];
        worst = k;
      }
    }
    s.cause[eid] = deathCauseIndex(worst);
  }
}

const kindName = (k: number) => WOUND_KINDS[k] ?? 'scratch';
