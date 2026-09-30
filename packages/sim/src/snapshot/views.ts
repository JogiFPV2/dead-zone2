import {
  BODY_PARTS,
  VIEW_STATS,
  WOUND_KINDS,
  type ClockView,
  type MoodleView,
  type PlayerId,
  type PlayerView,
  type SimViewPatch,
  type ViewStat,
  type WoundView,
} from '@deadzone/protocol';
import {
  dayOf,
  gameMinuteAt,
  minuteOfDay,
  minuteStartTick,
  ticksPerGameMinute,
} from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { threatNearby } from '../systems/sleep.js';
import { bandageDirty, woundBleeding } from '../survival/wounds.js';

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Full wound list of a player for the UI (wound id order). */
export function woundViews(w: SimWorld, eid: number): WoundView[] {
  const s = w.survival;
  if (!s) return [];
  const cfg = s.content.survival.wounds;
  return (s.wounds.get(w.c.StableId.value[eid] ?? 0) ?? []).map((wd) => ({
    part: BODY_PARTS[wd.part] ?? 'torso_upper',
    wound: WOUND_KINDS[wd.kind] ?? 'scratch',
    bleeding: round1(woundBleeding(cfg, wd)),
    healed: round2(wd.healed),
    bandaged: wd.bandaged,
    bandageDirty: bandageDirty(cfg, wd),
    infected: wd.dirt,
  }));
}

/**
 * Host-side view diff (docs 4.2): remembers what was sent last and returns only changes. Not
 * simulation state (never hashed); a fresh tracker sends everything once.
 */
export class ViewTracker {
  private clockKey = '';
  private alive: boolean | undefined;
  private sleeping: boolean | undefined;
  private readonly stats = new Map<ViewStat, number>();
  private moodles: number[] = [];
  private woundsKey = '';

  constructor(private readonly playerId: PlayerId = 0) {}

  diff(w: SimWorld): SimViewPatch | undefined {
    const patch: SimViewPatch = {};
    const minute = gameMinuteAt(w.clock, Math.max(0, w.tick - 1));
    const eid = w.players.get(this.playerId);
    const clock: ClockView = {
      day: dayOf(minute),
      minuteOfDay: minuteOfDay(minute),
      ticksPerGameMinute: ticksPerGameMinute(w.clock),
      minuteStartTick: minuteStartTick(w.clock, minute),
      fastForwardBlocked: eid !== undefined && threatNearby(w, eid),
    };
    const key = `${minute}|${clock.fastForwardBlocked}`;
    if (key !== this.clockKey) {
      this.clockKey = key;
      patch.clock = clock;
    }
    const s = w.survival;
    if (s && eid !== undefined) {
      const p: PlayerView = {};
      const alive = !s.dead[eid];
      if (alive !== this.alive) p.alive = this.alive = alive;
      const sleeping = s.asleep[eid] === 1;
      if (sleeping !== this.sleeping) p.sleeping = this.sleeping = sleeping;
      for (const stat of VIEW_STATS) {
        const v = round1(s.vitals[stat][eid] ?? 0);
        if (this.stats.get(stat) !== v) {
          this.stats.set(stat, v);
          (p.stats ??= {})[stat] = v;
        }
      }
      const list = s.content.moodles;
      const changed: MoodleView[] = [];
      for (let i = 0; i < list.length; i++) {
        const level = s.moodles[eid * list.length + i] ?? 0;
        if ((this.moodles[i] ?? 0) !== level) changed.push({ id: list[i]!.id, level });
        this.moodles[i] = level;
      }
      if (changed.length > 0) p.moodles = changed;
      const wounds = woundViews(w, eid);
      const wk = JSON.stringify(wounds);
      if (wk !== this.woundsKey) {
        this.woundsKey = wk;
        p.wounds = wounds;
      }
      if (Object.keys(p).length > 0) patch.player = p;
    }
    return patch.clock || patch.player ? patch : undefined;
  }
}
