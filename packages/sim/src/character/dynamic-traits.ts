import type { HashWriter } from '../core/hash.js';
import { hashString32 } from '../core/rng.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { stableIdOf } from '../items/inventory.js';
import type { ItemStore } from '../items/store.js';
import type { MinuteTicks } from '../systems/clock.js';
import { refreshModifiers } from '../systems/moodles.js';
import type { TraitDef } from '../content/adapter.js';

type Condition = NonNullable<TraitDef['gainedWhen']>;

/**
 * Value of a trait condition stat for a player: body weight (survival vitals) or the game
 * counters (`zombies-killed`); undefined for stats the sim does not track.
 */
export function conditionStat(w: SimWorld, eid: number, stat: string): number | undefined {
  if (stat === 'body-weight-kg') return w.survival?.vitals['body-weight-kg'][eid];
  if (stat === 'zombies-killed') return w.ai?.combat.kills[eid];
  return undefined;
}

const holds = (v: number, c: Condition): boolean => (c.op === 'gte' ? v >= c.value : v <= c.value);

/** Content traits that can come or go during the game, in id order (deterministic). */
function dynamicTraits(st: ItemStore): [string, TraitDef][] {
  return [...st.content.traits].filter(([, t]) => t.gainedWhen || t.lostWhen);
}

/**
 * Pipeline step `traits` (docs 9.83): once per game minute, for every living player with a
 * character, a trait with `gainedWhen` is gained and one with `lostWhen` lost once the condition
 * has held without a break for `sustainedMin` game minutes. A gained trait drops the traits it
 * conflicts with. The start minute of a running condition is in `ItemStore.traitSince` (saved),
 * so a load in the middle keeps counting.
 */
export function dynamicTraitsSystem(w: SimWorld, minutes: MinuteTicks): void {
  const st = w.items;
  const s = w.survival;
  if (!st || !s || minutes.count === 0 || st.characters.size === 0) return;
  const defs = dynamicTraits(st);
  if (defs.length === 0) return;
  const minute = minutes.first + minutes.count - 1;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if (s.dead[eid]) continue;
    const sid = stableIdOf(w, eid);
    const ch = st.characters.get(sid);
    if (!ch) continue;
    const since = { ...(st.traitSince.get(sid) ?? {}) };
    let traits = ch.traits;
    const changes: { trait: string; gained: boolean }[] = [];
    for (const [id, t] of defs) {
      const has = traits.includes(id);
      const cond = has ? t.lostWhen : t.gainedWhen;
      const v = cond && conditionStat(w, eid, cond.stat);
      if (!cond || v === undefined || !holds(v, cond)) {
        delete since[id];
        continue;
      }
      const start = since[id] ?? minute;
      if (minute - start < cond.sustainedMin) {
        since[id] = start;
        continue;
      }
      delete since[id];
      if (has) traits = traits.filter((x) => x !== id);
      else {
        const lost = traits.filter(
          (x) => t.conflicts.includes(x) || st.content.traits.get(x)?.conflicts.includes(id),
        );
        for (const x of lost) changes.push({ trait: x, gained: false });
        traits = [...traits.filter((x) => !lost.includes(x)), id].sort();
      }
      changes.push({ trait: id, gained: !has });
    }
    if (Object.keys(since).length) st.traitSince.set(sid, since);
    else st.traitSince.delete(sid);
    if (changes.length === 0) continue;
    st.characters.set(sid, { ...ch, traits });
    refreshModifiers(w, s, eid);
    st.version++;
    const playerId = w.c.Player.id[eid] ?? 0;
    for (const c of changes)
      w.events.push({
        type: 'traitChanged',
        tick: w.tick,
        playerId,
        trait: c.trait,
        gained: c.gained,
        polarity: st.content.traits.get(c.trait)?.polarity ?? 'neutral',
      });
  }
}

/** Hash section of running trait conditions (only when any; keeps older goldens). */
export function hashTraitSince(st: ItemStore, h: HashWriter): void {
  if (st.traitSince.size === 0) return;
  const sids = [...st.traitSince.keys()].sort((a, b) => a - b);
  h.u32(sids.length);
  for (const sid of sids) {
    const m = st.traitSince.get(sid)!;
    h.u32(sid).u32(hashString32(JSON.stringify(Object.entries(m).sort())));
  }
}
