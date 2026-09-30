import { BODY_PARTS, WOUND_KINDS } from '@deadzone/protocol';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { clampStat, type SurvivalWorld, type Wound } from './state.js';

type WoundSettings = SurvivalWorld['content']['survival']['wounds'];

const kindOf = (cfg: WoundSettings, w: Wound) => cfg.types[WOUND_KINDS[w.kind] ?? 'scratch'];

export const bandageDirty = (cfg: WoundSettings, w: Wound): boolean =>
  w.bandaged && w.bandageAgeMin >= cfg.bandage.dirtyAfterMin;

/** Current bleeding of one wound: fades with healing, 0 after clotting, bandage multiplies it. */
export function woundBleeding(cfg: WoundSettings, w: Wound): number {
  const t = kindOf(cfg, w);
  if (t.clotsAfterMin > 0 && w.ageMin >= t.clotsAfterMin) return 0;
  const bandage = w.bandaged
    ? bandageDirty(cfg, w)
      ? cfg.bandage.dirtyBleedingMul
      : cfg.bandage.bleedingMul
    : 1;
  return t.bleeding * (1 - w.healed) * bandage;
}

export function woundPain(cfg: WoundSettings, w: Wound): number {
  return kindOf(cfg, w).pain * (1 - w.healed) + (w.dirt ? cfg.dirtInfection.painAdd : 0);
}

export function woundsOf(s: SurvivalWorld, stableId: number): Wound[] {
  let list = s.wounds.get(stableId);
  if (!list) {
    list = [];
    s.wounds.set(stableId, list);
  }
  return list;
}

/** Sums wounds into the `bleeding` and `pain` stats (called after every wound change). */
export function recomputeWoundStats(s: SurvivalWorld, eid: number, stableId: number): void {
  const cfg = s.content.survival.wounds;
  let bleeding = 0;
  let pain = 0;
  for (const wd of s.wounds.get(stableId) ?? []) {
    bleeding += woundBleeding(cfg, wd);
    pain += woundPain(cfg, wd);
  }
  s.vitals.bleeding[eid] = clampStat(bleeding);
  s.vitals.pain[eid] = clampStat(pain);
}

/**
 * Inflicts a wound (debug command now, zombie attacks and glass later). A zombie wound rolls the
 * virus with the kind's `zombieInfectionChance` on the `health` RNG stream.
 */
export function inflictWound(
  w: SimWorld,
  eid: number,
  part: number,
  kind: number,
  opts: { zombie?: boolean } = {},
): Wound | undefined {
  const s = w.survival;
  if (!s || s.dead[eid]) return undefined;
  const stableId = w.c.StableId.value[eid] ?? 0;
  const wound: Wound = {
    id: s.nextWoundId++,
    part,
    kind,
    ageMin: 0,
    healed: 0,
    bandaged: false,
    bandageAgeMin: 0,
    dirt: false,
  };
  woundsOf(s, stableId).push(wound);
  const cfg = s.content.survival;
  if (opts.zombie && !s.virus[eid]) {
    const chance = kindOf(cfg.wounds, wound).zombieInfectionChance;
    if (chance > 0 && w.rng.health.chance(chance)) {
      const inf = cfg.infection;
      const incubation = w.rng.health.int(inf.incubationMin.min, inf.incubationMin.max);
      const death = w.rng.health.int(inf.deathAfterMin.min, inf.deathAfterMin.max);
      s.virus[eid] = 1;
      s.virusStart[eid] = gameMinuteAt(w.clock, w.tick);
      s.virusIncubation[eid] = incubation;
      s.virusDeath[eid] = Math.max(death, incubation + 1);
    }
  }
  recomputeWoundStats(s, eid, stableId);
  w.events.push({
    type: 'wounded',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    part: BODY_PARTS[part] ?? 'torso_upper',
    wound: WOUND_KINDS[kind] ?? 'scratch',
  });
  return wound;
}

/** Puts a clean bandage on every wound of `part`. Returns how many wounds were dressed. */
export function bandagePart(w: SimWorld, eid: number, part: number): number {
  const s = w.survival;
  if (!s) return 0;
  const stableId = w.c.StableId.value[eid] ?? 0;
  let n = 0;
  for (const wd of s.wounds.get(stableId) ?? []) {
    if (wd.part !== part) continue;
    wd.bandaged = true;
    wd.bandageAgeMin = 0;
    n++;
  }
  if (n > 0) recomputeWoundStats(s, eid, stableId);
  return n;
}
