import type { HashWriter } from '../core/hash.js';
import { dayOf, gameMinuteAt } from '../core/clock.js';
import { deriveSeed, Rng } from '../core/rng.js';
import type { SimWorld } from '../core/world.js';
import { restamp } from './spoilage.js';
import type { ItemStore } from './store.js';

/**
 * Mains power and water (`worldSettings.utilities`, docs/sim-architecture.md 9.46): each goes
 * off once, on a day rolled from the world seed in `offAfterDays` (counted from the start day).
 * Power off: fridges / freezers stop cooling (items there are re-stamped first, so the time so far
 * keeps the cold rate and food thaws and spoils normally from now on), TVs, electric stoves and
 * fast pumps stop. Water off: taps run dry. Generators come later.
 */
export function initUtilities(w: SimWorld): void {
  const st = w.items;
  if (!st) return;
  const cfg = st.content.utilities;
  const start = dayOf(w.clock.startMinute);
  const rng = Rng.fromSeed(deriveSeed(w.seed, 'utilities'));
  const roll = (u: { enabled: boolean; offAfterDays: { min: number; max: number } } | undefined) =>
    u && !u.enabled ? 0 : start + rng.int(u?.offAfterDays.min ?? 7, u?.offAfterDays.max ?? 30);
  st.powerOffDay = roll(cfg?.power);
  st.waterOffDay = roll(cfg?.water);
}

/** Pipeline step `utilities` (after the clock): switches power / water off on their day. */
export function utilitiesSystem(w: SimWorld): void {
  const st = w.items;
  if (!st || (!st.powered && !st.water)) return;
  const minute = gameMinuteAt(w.clock, w.tick);
  const day = dayOf(minute);
  if (st.powered && st.powerOffDay > 0 && day >= st.powerOffDay) {
    setPower(st, false, minute);
    w.events.push({ type: 'utilityChanged', tick: w.tick, utility: 'power', on: false });
  }
  if (st.water && st.waterOffDay > 0 && day >= st.waterOffDay) {
    st.water = false;
    st.version++;
    w.events.push({ type: 'utilityChanged', tick: w.tick, utility: 'water', on: false });
  }
}

/**
 * Switches mains power, re-stamping the food in power-cooled storage first (lazy spoilage keeps
 * one rate per stretch, see items/spoilage.ts).
 */
export function setPower(st: ItemStore, on: boolean, minute: number): void {
  if (st.powered === on) return;
  for (const c of st.containers.values()) {
    if (c.type < 0 || !st.content.containerTypes[c.type]?.requiresPower) continue;
    for (const id of c.items) {
      const item = st.items.get(id);
      if (item) restamp(st, item, minute);
    }
  }
  st.powered = on;
  st.version++;
}

/** Hash section: mains water, only once it is off (older goldens unchanged). */
export function hashUtilities(st: ItemStore, h: HashWriter): void {
  if (!st.water) h.u32(0x7574_0001).u32(0);
}
