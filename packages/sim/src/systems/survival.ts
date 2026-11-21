import { SPRINT_ENDURANCE_MUL } from '../physics/constants.js';
import { effectiveGait } from './movement.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { ModSlot } from '../content/adapter.js';
import { clampStat, modded, type SurvivalWorld } from '../survival/state.js';
import { hygieneMinute } from '../survival/hygiene.js';
import { weatherWetPerMin } from '@deadzone/protocol';
import type { TileGrid } from '../world/grid.js';
import { floorZ } from '../world/levels.js';
import { weatherNow } from '../world/weather.js';
import { seatOf } from '../vehicles/seats.js';

/** Ambient temperature before weather (inside the comfort band of the base data). */
export const DEFAULT_AMBIENT_C = 20;

/**
 * Pipeline step 13 (per game minute): needs and mind. Rates are data (`worldSettings.survival`,
 * points 0–100 per game minute) × activity multipliers × moodle modifiers.
 */
export function survivalSystem(
  w: SimWorld,
  first: number,
  count: number,
  ambientC: number,
  /** Map grid: with weather on, rain wets players outdoors (not on a room tile). */
  grid?: TileGrid,
): void {
  const s = w.survival;
  if (!s) return;
  for (let m = first; m < first + count; m++) {
    // Weather (docs 9.45): colder air, and rain / snow outdoors.
    const wx = weatherNow(w, m);
    const air = ambientC + (wx?.tempC ?? 0);
    const wet = wx ? weatherWetPerMin(wx) : 0;
    for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
      if (s.dead[eid]) continue;
      if (wet > 0 && grid && !indoors(w, grid, eid))
        s.vitals.wetness[eid] = clampStat((s.vitals.wetness[eid] ?? 0) + wet);
      survivalMinute(w, s, eid, air);
    }
  }
}

/** Player on a room tile (under a roof) or in a car. */
function indoors(w: SimWorld, grid: TileGrid, eid: number): boolean {
  if (seatOf(w, w.c.StableId.value[eid] ?? 0)) return true;
  const x = Math.floor(w.c.Position.x[eid] ?? 0);
  const y = Math.floor(w.c.Position.y[eid] ?? 0);
  return grid.roomAt(x, y, floorZ(w, eid)) !== 0;
}

/** Sprinting: the running activity with `SPRINT_ENDURANCE_MUL` × its endurance drain. */
function sprintActivity<T extends { endurancePerMin: number }>(run: T): T {
  const e = run.endurancePerMin;
  return { ...run, endurancePerMin: e < 0 ? e * SPRINT_ENDURANCE_MUL : e };
}

function survivalMinute(w: SimWorld, s: SurvivalWorld, eid: number, ambientC: number): void {
  const cfg = s.content.survival;
  const v = s.vitals;
  const asleep = s.asleep[eid] === 1;
  const moving =
    !asleep && ((w.c.MoveIntent.dx[eid] ?? 0) !== 0 || (w.c.MoveIntent.dy[eid] ?? 0) !== 0);
  const gait = moving ? effectiveGait(w, eid) : 'walk';
  const act = asleep
    ? cfg.activity.sleeping
    : !moving
      ? cfg.activity.idle
      : gait === 'sprint'
        ? sprintActivity(cfg.activity.running)
        : gait === 'run'
          ? cfg.activity.running
          : gait === 'sneak'
            ? cfg.activity.sneaking
            : cfg.activity.walking;

  // Needs.
  const satiety = v.satiety[eid] ?? 0;
  const hungerRate =
    cfg.needs.hungerPerMin * act.hunger * (satiety > 0 ? cfg.nutrition.satiety.hungerRateMul : 1);
  v.hunger[eid] = clampStat(
    (v.hunger[eid] ?? 0) + modded(s, eid, ModSlot['hunger-rate'], hungerRate),
  );
  v.thirst[eid] = clampStat(
    (v.thirst[eid] ?? 0) +
      modded(s, eid, ModSlot['thirst-rate'], cfg.needs.thirstPerMin * act.thirst),
  );
  if (!asleep) {
    v.fatigue[eid] = clampStat(
      (v.fatigue[eid] ?? 0) +
        modded(s, eid, ModSlot['fatigue-rate'], cfg.needs.fatiguePerMin * act.fatigue),
    );
  }
  const e = act.endurancePerMin;
  v.endurance[eid] = clampStat(
    (v.endurance[eid] ?? 0) + (e > 0 ? modded(s, eid, ModSlot['endurance-regen'], e) : e),
  );
  v.satiety[eid] = clampStat(satiety - cfg.nutrition.satiety.decayPerMin);

  // Calories and body weight (no food yet: only the burn).
  const n = cfg.nutrition;
  const kcal = Math.fround((s.kcal[eid] ?? 0) - (n.dailyBurnKcal / 1440) * act.hunger);
  s.kcal[eid] = kcal;
  v['body-weight-kg'][eid] = Math.fround(n.startBodyWeightKg + kcal / n.kcalPerKg);

  // Mind.
  const b = cfg.boredom;
  if (!asleep) {
    v.boredom[eid] = clampStat(
      (v.boredom[eid] ?? 0) + (moving ? -b.activeDecayPerMin : b.idleGainPerMin),
    );
  }
  const st = cfg.stress;
  const needy =
    (v.hunger[eid] ?? 0) >= st.needsThreshold || (v.thirst[eid] ?? 0) >= st.needsThreshold;
  const stressGain =
    (v.pain[eid] ?? 0) * st.fromPainPerMin +
    (v.panic[eid] ?? 0) * st.fromPanicPerMin +
    (needy ? st.fromNeedsPerMin : 0);
  v.stress[eid] = clampStat((v.stress[eid] ?? 0) + (stressGain > 0 ? stressGain : -st.decayPerMin));
  const u = cfg.unhappiness;
  const unhappyGain =
    ((v.boredom[eid] ?? 0) > u.fromBoredomAbove ? u.boredomGainPerMin : 0) +
    ((v.stress[eid] ?? 0) > u.fromStressAbove ? u.stressGainPerMin : 0);
  v.unhappiness[eid] = clampStat(
    (v.unhappiness[eid] ?? 0) + (unhappyGain > 0 ? unhappyGain : -u.decayPerMin),
  );

  hygieneMinute(s, eid);

  // Wetness dries (rain adds to it first, `survivalSystem`); the slower outdoor rate.
  const wetness = clampStat((v.wetness[eid] ?? 0) - cfg.wetness.dryOutdoorsPerMin);
  v.wetness[eid] = wetness;

  // Body temperature: outside the comfort band the body cools / heats proportionally, inside it
  // returns to base + fever (zombie virus after incubation).
  const t = cfg.temperature;
  const feels = ambientC - (wetness / 100) * cfg.wetness.feelsColderAtMaxC;
  const fever =
    (v.sickness[eid] ?? 0) > 0 ? (cfg.infection.feverMaxC * (v.infection[eid] ?? 0)) / 100 : 0;
  const target = t.bodyBaseC + fever;
  let temp = v['body-temperature-c'][eid] ?? t.bodyBaseC;
  if (feels < t.comfortMinC) temp -= t.coolingPerDegPerMin * (t.comfortMinC - feels);
  else if (feels > t.comfortMaxC) temp += t.heatingPerDegPerMin * (feels - t.comfortMaxC);
  else if (temp < target) temp = Math.min(target, temp + t.recoveryPerMin);
  else if (temp > target) temp = Math.max(target, temp - t.recoveryPerMin);
  v['body-temperature-c'][eid] = Math.fround(temp < 20 ? 20 : temp > 45 ? 45 : temp);
}
