import { sortedQuery, type SimWorld } from '../core/world.js';
import { MOD_STATS, type CompiledMoodle, type ConditionDef } from '../content/adapter.js';
import { statValue, type SurvivalWorld } from '../survival/state.js';

/**
 * Next level of one moodle with hysteresis: a level turns on at `enterAt` and off only past
 * `exitAt` (data guarantees exitAt ≤ enterAt when rising, ≥ when falling).
 */
export function nextMoodleLevel(m: CompiledMoodle, level: number, value: number): number {
  let l = level;
  if (m.rising) {
    while (l < m.maxLevel && value >= (m.enterAt[l] ?? Infinity)) l++;
    while (l > 0 && value < (m.exitAt[l - 1] ?? -Infinity)) l--;
  } else {
    while (l < m.maxLevel && value <= (m.enterAt[l] ?? -Infinity)) l++;
    while (l > 0 && value > (m.exitAt[l - 1] ?? Infinity)) l--;
  }
  return l;
}

/**
 * Pipeline step 16 (every tick, after all stats): moodle levels from stats, `moodleChanged`
 * events and the modifier cache (only the current level's modifiers apply, not cumulative).
 * Moodles on stats the sim does not track yet (carry-load, drunkenness, comfort) stay hidden.
 */
export function moodlesSystem(w: SimWorld, refreshMods: boolean): void {
  const s = w.survival;
  if (!s) return;
  const list = s.content.moodles;
  const n = list.length;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if (s.dead[eid]) continue;
    let changed = refreshMods;
    for (let i = 0; i < n; i++) {
      const m = list[i]!;
      const value = statValue(s, eid, m.stat);
      if (value === undefined) continue;
      const at = eid * n + i;
      const from = s.moodles[at] ?? 0;
      const to = nextMoodleLevel(m, from, value);
      if (to === from) continue;
      s.moodles[at] = to;
      changed = true;
      w.events.push({
        type: 'moodleChanged',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        moodle: m.id,
        from,
        to,
      });
    }
    if (changed) refreshModifiers(w, s, eid);
  }
}

/** Rebuilds the derived modifier cache of one player from moodle levels (moodle id order). */
export function refreshModifiers(w: SimWorld, s: SurvivalWorld, eid: number): void {
  const k = MOD_STATS.length;
  for (let i = 0; i < k; i++) {
    s.modMul[eid * k + i] = 1;
    s.modAdd[eid * k + i] = 0;
  }
  const list = s.content.moodles;
  for (let i = 0; i < list.length; i++) {
    const level = s.moodles[eid * list.length + i] ?? 0;
    if (level === 0) continue;
    for (const mod of list[i]!.modifiers[level - 1] ?? []) {
      if (mod.when && !conditionHolds(w, s, eid, mod.when)) continue;
      const at = eid * k + mod.slot;
      if (mod.op === 'mul') s.modMul[at] = Math.fround((s.modMul[at] ?? 1) * mod.value);
      else s.modAdd[at] = Math.fround((s.modAdd[at] ?? 0) + mod.value);
    }
  }
}

/** Declarative conditions from data; skills and traits are not simulated yet (→ false). */
export function conditionHolds(
  w: SimWorld,
  s: SurvivalWorld,
  eid: number,
  c: ConditionDef,
): boolean {
  if ('moodle' in c) {
    const i = s.content.moodleIndex.get(c.moodle);
    return i !== undefined && (s.moodles[eid * s.content.moodles.length + i] ?? 0) >= c.minLevel;
  }
  if ('stat' in c) {
    const v = statValue(s, eid, c.stat);
    return v !== undefined && (c.op === 'gte' ? v >= c.value : v <= c.value);
  }
  if ('all' in c) return c.all.every((x) => conditionHolds(w, s, eid, x));
  if ('any' in c) return c.any.some((x) => conditionHolds(w, s, eid, x));
  if ('not' in c) return !conditionHolds(w, s, eid, c.not);
  return false;
}
