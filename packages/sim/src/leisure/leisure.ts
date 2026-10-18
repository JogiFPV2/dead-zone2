import type { ActionState } from '../items/store.js';
import { seatNear } from '../systems/sleep.js';
import {
  CHUNK_SIZE,
  type Command,
  type CommandRejectReason,
  type LeisureActivity,
} from '@deadzone/protocol';
import { newAction, registerAction, startAction } from '../actions/queue.js';
import { ticksPerGameMinute } from '../core/clock.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import type { HashWriter } from '../core/hash.js';
import { hashString32 } from '../core/rng.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems } from '../items/actions.js';
import { canReach, playerItems, stableIdOf } from '../items/inventory.js';
import { defOf, tileKey, type ItemStore } from '../items/store.js';
import { addXp } from '../progress/skills.js';
import { clampStat } from '../survival/state.js';
import { floorZ } from '../world/levels.js';

/**
 * Leisure (`worldSettings.survival.leisure`): reading, TV sessions and VHS tapes. Every finished
 * session rests some fatigue and removes boredom and stress (`leisureCompleted`). A VHS tape
 * also gives its skill XP once per character (`vhsWatched`); watched tapes are remembered per
 * player StableId in `ItemStore.vhsWatched` (saved with the items).
 */

type ItemDef = ItemStore['content']['items'][number];

const isTv = (def: ItemDef | undefined, tag: string): boolean =>
  def?.kind === 'placeable' && def.placeable.power !== undefined && def.tags.includes(tag);

/**
 * TV with `tag` within `leisure.tvRadiusTiles` on the player's floor: a map object or a TV item
 * lying on a ground pile. `no-station` without a TV, `no-power` without mains (`items.powered`;
 * generators are not simulated yet).
 */
export function tvCheck(w: SimWorld, eid: number, tag: string): CommandRejectReason | undefined {
  const st = w.items;
  const s = w.survival;
  if (!st || !s) return 'invalid-state';
  const r = s.content.survival.leisure.tvRadiusTiles;
  const { Position } = w.c;
  const px = Position.x[eid] ?? 0;
  const py = Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const near = (x: number, y: number): boolean => {
    const dx = x + 0.5 - px;
    const dy = y + 0.5 - py;
    return dx * dx + dy * dy <= r * r;
  };
  let found = false;
  for (let cy = Math.floor((py - r) / CHUNK_SIZE); cy <= Math.floor((py + r) / CHUNK_SIZE); cy++) {
    for (
      let cx = Math.floor((px - r) / CHUNK_SIZE);
      cx <= Math.floor((px + r) / CHUNK_SIZE);
      cx++
    ) {
      for (const obj of w.map.getChunk(cx, cy, z)?.objects ?? []) {
        const def = st.content.items[st.content.itemIndex.get(obj.contentId) ?? -1];
        if (isTv(def, tag) && near(cx * CHUNK_SIZE + obj.x, cy * CHUNK_SIZE + obj.y)) found = true;
      }
    }
  }
  for (let y = Math.floor(py - r); !found && y <= Math.floor(py + r); y++) {
    for (let x = Math.floor(px - r); !found && x <= Math.floor(px + r); x++) {
      if (!near(x, y)) continue;
      const pile = st.ground.get(tileKey(x, y, z));
      if (pile === undefined) continue;
      for (const item of carriedItems(st, pile))
        if (item.loc === pile && isTv(defOf(st, item), tag)) found = true;
    }
  }
  if (!found) return 'no-station';
  return st.powered ? undefined : 'no-power';
}

/** Applies one session: fatigue, boredom and stress down; emits `leisureCompleted`. */
export function applyLeisure(
  w: SimWorld,
  eid: number,
  activity: LeisureActivity,
  extra: { boredom?: number; stress?: number; fatigueMul?: number } = {},
): void {
  const s = w.survival;
  if (!s) return;
  const cfg = s.content.survival.leisure[activity];
  const v = s.vitals;
  const drop = (stat: 'fatigue' | 'boredom' | 'stress', by: number): number => {
    const before = v[stat][eid] ?? 0;
    v[stat][eid] = clampStat(before - by);
    return Math.round((before - (v[stat][eid] ?? 0)) * 10) / 10;
  };
  const fatigue = drop('fatigue', cfg.fatigueRest * (extra.fatigueMul ?? 1));
  const boredom = drop('boredom', cfg.boredomReduction + (extra.boredom ?? 0));
  const stress = drop('stress', cfg.stressReduction + (extra.stress ?? 0));
  w.events.push({
    type: 'leisureCompleted',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    activity,
    fatigue,
    boredom,
    stress,
  });
}

type LeisureCommand = Extract<Command, { type: 'watchTv' | 'rest' }>;

export const isLeisureCommand = (cmd: Command): cmd is LeisureCommand =>
  cmd.type === 'watchTv' || cmd.type === 'rest';

/** `watchTv {vhs?}` → timed `watch` action (also `useItem` on a VHS tape); `rest` → `rest`. */
export function applyLeisureCommand(
  w: SimWorld,
  eid: number,
  cmd: LeisureCommand,
): CommandRejectReason | undefined {
  if (!w.items || !playerItems(w, eid)) return 'invalid-state';
  if (cmd.type === 'rest') return startAction(w, eid, newAction('rest'));
  return startAction(w, eid, newAction('watch', { item: cmd.vhs ?? 0 }));
}

/** Learning (skill / recipe books, VHS with XP, radio) needs fatigue < `learning.maxFatigue`. */
export function tooTiredToLearn(w: SimWorld, eid: number): boolean {
  const s = w.survival;
  if (!s) return false;
  return (s.vitals.fatigue[eid] ?? 0) >= s.content.survival.leisure.learning.maxFatigue;
}

/** Why `rest` cannot start (undefined = it can): `not-tired`, `threat` comes from the queue. */
export function restReason(w: SimWorld, eid: number): CommandRejectReason | undefined {
  const s = w.survival;
  if (!s || s.asleep[eid]) return 'invalid-state';
  return (s.vitals.fatigue[eid] ?? 0) < s.content.survival.leisure.rest.minFatigue
    ? 'not-tired'
    : undefined;
}

function watchCheck(w: SimWorld, eid: number, a: ActionState, start: boolean) {
  const st = w.items!;
  if (!a.item) return tvCheck(w, eid, w.survival?.content.survival.leisure.tvTag ?? '');
  const item = st.items.get(a.item);
  if (!item) return 'no-item';
  const def = defOf(st, item);
  if (def.kind !== 'vhs') return 'no-item';
  if (!canReach(w, eid, item.loc)) return 'out-of-range';
  // A tape that teaches (XP) needs a rested player at the start.
  if (start && def.vhs.skills.length > 0 && tooTiredToLearn(w, eid)) return 'tired';
  return tvCheck(w, eid, def.vhs.tvTag);
}

export function registerLeisureActions(): void {
  registerAction('rest', {
    validate: (w, eid) => restReason(w, eid),
    validateEnd: (w, eid) => (w.survival?.asleep[eid] ? 'invalid-state' : undefined),
    durationMin: (w) => w.survival?.content.survival.leisure.rest.sessionMin ?? 30,
    complete(w, eid) {
      const cfg = w.survival!.content.survival.leisure.rest;
      applyLeisure(w, eid, 'rest', { fatigueMul: seatNear(w, eid) ? 1 : cfg.floorMul });
    },
  });

  registerAction('watch', {
    validate: (w, eid, a) => watchCheck(w, eid, a, true),
    validateEnd: (w, eid, a) => watchCheck(w, eid, a, false),
    durationMin(w, _eid, a) {
      const st = w.items!;
      const item = a.item ? st.items.get(a.item) : undefined;
      const def = item ? defOf(st, item) : undefined;
      // VHS: `watchSec` real seconds at ×1 → game minutes of this world's day length.
      if (def?.kind === 'vhs')
        return (def.vhs.watchSec * TICKS_PER_SECOND) / ticksPerGameMinute(w.clock);
      return w.survival?.content.survival.leisure.tv.sessionMin ?? 30;
    },
    complete(w, eid, a) {
      const st = w.items!;
      const item = a.item ? st.items.get(a.item) : undefined;
      const def = item ? defOf(st, item) : undefined;
      if (def?.kind !== 'vhs') {
        applyLeisure(w, eid, 'tv');
        return;
      }
      const sid = stableIdOf(w, eid);
      const seen = st.vhsWatched.get(sid) ?? [];
      const repeat = seen.includes(def.id);
      const xp: { skill: string; xp: number }[] = [];
      if (!repeat || !def.vhs.oncePerCharacter) {
        for (const s of def.vhs.skills) {
          addXp(w, eid, s.skill, s.xp);
          xp.push({ skill: s.skill, xp: s.xp });
        }
      }
      if (!repeat) {
        st.vhsWatched.set(sid, [...seen, def.id].sort());
        st.version++;
      }
      w.events.push({
        type: 'vhsWatched',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        vhs: def.id,
        xp,
        repeat,
      });
      applyLeisure(w, eid, 'vhs');
    },
  });
}

/** Hash section: watched tapes (only when any, keeps older goldens). */
export function hashVhsWatched(st: ItemStore, h: HashWriter): void {
  if (st.vhsWatched.size === 0) return;
  const sids = [...st.vhsWatched.keys()].sort((a, b) => a - b);
  h.u32(0x0717_0001).u32(sids.length);
  for (const sid of sids) {
    const list = st.vhsWatched.get(sid)!;
    h.u32(sid).u32(list.length);
    for (const id of list) h.u32(hashString32(id));
  }
}
