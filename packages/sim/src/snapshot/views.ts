import {
  BODY_PARTS,
  VIEW_STATS,
  WOUND_KINDS,
  type ClockView,
  type CombatView,
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
  MINUTES_PER_DAY,
  minuteOfDay,
  minuteStartTick,
  ticksPerGameMinute,
} from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { actionView, inventoryView, nearbyView, openContainerView } from '../items/views.js';
import { threatNearby } from '../systems/sleep.js';
import { threatLevel } from '../ai/threat.js';
import { meleeOf } from '../combat/system.js';
import { defOf, maxCondition } from '../items/store.js';
import { DEATH_CAUSES } from '../survival/state.js';
import { bandageDirty, woundBleeding } from '../survival/wounds.js';

function combatView(w: SimWorld, eid: number): CombatView {
  const cb = w.ai!.combat;
  const m = meleeOf(w, cb, eid);
  const item = m.item === undefined ? undefined : w.items?.items.get(m.item);
  const def = item && w.items ? defOf(w.items, item) : undefined;
  return {
    zombiesKilled: cb.kills[eid] ?? 0,
    weapon: def?.id ?? null,
    condition: item ? item.condition : null,
    maxCondition: def ? maxCondition(def) : null,
    readyTick: cb.readyTick[eid] ?? 0,
  };
}

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
  private invHeaderKey = '';
  private readonly invContainers = new Map<number, string>();
  private openKey = '';
  private nearbyKey = '';
  private actionKey = '';
  private threat: number | undefined;
  private combatKey = '';
  private deathSent = false;

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
    if (w.items && eid !== undefined) this.diffItems(w, eid, patch);
    return Object.keys(patch).length > 0 ? patch : undefined;
  }

  /** Inventory (header + changed carried containers), open container, nearby, action. */
  private diffItems(w: SimWorld, eid: number, patch: SimViewPatch): void {
    const inv = inventoryView(w, eid);
    if (inv) {
      const { containers = [], ...header } = inv;
      const changed = [];
      const seen = new Set<number>();
      for (const c of containers) {
        seen.add(c.id);
        const key = JSON.stringify(c);
        if (this.invContainers.get(c.id) !== key) {
          this.invContainers.set(c.id, key);
          changed.push(c);
        }
      }
      const removed = [...this.invContainers.keys()].filter((id) => !seen.has(id));
      for (const id of removed) this.invContainers.delete(id);
      const headerKey = JSON.stringify(header);
      if (headerKey !== this.invHeaderKey || changed.length > 0 || removed.length > 0) {
        this.invHeaderKey = headerKey;
        patch.inventory = {
          ...header,
          ...(changed.length > 0 ? { containers: changed } : {}),
          ...(removed.length > 0 ? { removed } : {}),
        };
      }
    }
    const open = openContainerView(w, eid);
    const openKey = JSON.stringify(open);
    if (openKey !== this.openKey) {
      // First view: `null` is only sent after something was open.
      if (this.openKey !== '' || open) patch.container = open;
      this.openKey = openKey;
    }
    const nearby = nearbyView(w, eid);
    const nearbyKey = JSON.stringify(nearby);
    if (nearbyKey !== this.nearbyKey) {
      this.nearbyKey = nearbyKey;
      patch.nearby = nearby;
    }
    const action = actionView(w, eid);
    const actionKey = JSON.stringify(action);
    if (actionKey !== this.actionKey) {
      if (this.actionKey !== '' || action) patch.action = action;
      this.actionKey = actionKey;
    }
    if (w.ai) {
      const threat = threatLevel(w, eid);
      if (threat !== this.threat) {
        this.threat = threat;
        patch.threat = threat;
      }
      const cv = combatView(w, eid);
      const ck = JSON.stringify(cv);
      if (ck !== this.combatKey) {
        this.combatKey = ck;
        patch.combat = cv;
      }
      const s = w.survival;
      if (s?.dead[eid] && !this.deathSent) {
        this.deathSent = true;
        const minute = gameMinuteAt(w.clock, Math.max(0, w.tick - 1));
        patch.death = {
          cause: DEATH_CAUSES[s.cause[eid] ?? 0] ?? 'wounds',
          day: dayOf(minute),
          daysSurvived: Math.max(0, Math.floor((minute - w.clock.startMinute) / MINUTES_PER_DAY)),
          zombiesKilled: w.ai.combat.kills[eid] ?? 0,
        };
      }
    }
  }
}
