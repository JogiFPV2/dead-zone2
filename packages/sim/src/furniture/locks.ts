import type { CommandRejectReason } from '@deadzone/protocol';
import { registerAction } from '../actions/queue.js';
import { emitNoise } from '../ai/noise.js';
import { gridOf } from '../ai/commands.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { ticksPerGameMinute } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import { defOf, destroyItem, type ActionState, type ItemInstance } from '../items/store.js';
import { addXp, skillLevel } from '../progress/skills.js';
import { floorZ } from '../world/levels.js';
import { edgeAt, edgeCentre, edgeInReach, emitOpeningChanged } from '../openings/actions.js';
import {
  edgeTiles,
  isDoorLike,
  OpeningKind,
  OS,
  roomAt,
  setOpening,
  unpackKey,
} from '../openings/state.js';

/**
 * Door locks (protocol 26, docs 9.47): building keys (`ItemInstance.buildingId`, from loot tables
 * with `buildingKey`), lockpicks (`locks.lockpick.tag`, chance by skill, may break), knocking.
 * From inside the building a lock turns without a key (PZ); from outside it needs the key.
 */

const secMin = (w: SimWorld, sec: number): number =>
  (sec * TICKS_PER_SECOND) / ticksPerGameMinute(w.clock);

const locksCfg = (w: SimWorld) => w.openings.cfg.locks;

/** Building of a door: the building id of the room on either side (0 = none known). */
export function doorBuilding(w: SimWorld, key: number): number {
  const z = unpackKey(key).z;
  for (const t of edgeTiles(key)) {
    const r = roomAt(w.map, t.x, t.y, z);
    if (r && r.building > 0) return r.building;
  }
  return 0;
}

/** The player stands inside, in a room the door belongs to (or the same building). */
export function insideOf(w: SimWorld, eid: number, key: number): boolean {
  const z = unpackKey(key).z;
  const me = roomAt(
    w.map,
    Math.floor(w.c.Position.x[eid] ?? 0),
    Math.floor(w.c.Position.y[eid] ?? 0),
    floorZ(w, eid),
  );
  if (!me || me.room === 0) return false;
  for (const t of edgeTiles(key)) {
    const r = roomAt(w.map, t.x, t.y, z);
    if (!r || r.room === 0) continue;
    if (r.room === me.room || (r.building > 0 && r.building === me.building)) return true;
  }
  return false;
}

/** A carried key to this building (tag `locks.keyTag` and the same `buildingId`). */
export function keyFor(w: SimWorld, eid: number, building: number): ItemInstance | undefined {
  const st = w.items;
  const p = playerItems(w, eid);
  if (!st || !p || building <= 0) return undefined;
  const tag = locksCfg(w)?.keyTag ?? 'base:building-key';
  return carriedItems(st, p.inventory).find(
    (i) => i.buildingId === building && defOf(st, i).tags.includes(tag),
  );
}

/** Carried lockpicks, one per item kind (first instance; UI order). */
export function carriedLockpicks(w: SimWorld, eid: number): ItemInstance[] {
  const st = w.items;
  const p = playerItems(w, eid);
  if (!st || !p) return [];
  const tag = locksCfg(w)?.lockpick.tag ?? 'base:lockpick';
  const seen = new Set<number>();
  const out: ItemInstance[] = [];
  for (const i of carriedItems(st, p.inventory)) {
    if (seen.has(i.def) || !defOf(st, i).tags.includes(tag)) continue;
    seen.add(i.def);
    out.push(i);
  }
  return out;
}

/** Lockpick success chance for this player (0..0.95). */
export function lockpickChance(w: SimWorld, eid: number): number {
  const lp = locksCfg(w)?.lockpick;
  if (!lp) return 0;
  return Math.min(0.95, lp.chance + skillLevel(w, eid, lp.skill) * lp.chancePerLevel);
}

type Door = ReturnType<typeof edgeAt>;

function door(w: SimWorld, eid: number, a: ActionState): Door | CommandRejectReason {
  if (a.edge === undefined) return 'invalid-target';
  const k = unpackKey(a.edge);
  const t = edgeAt(gridOf(w), w, a.edge % 2, k.tx, k.ty, k.z);
  if (!isDoorLike(t.kind)) return 'invalid-target';
  if (!edgeInReach(w, eid, a.edge)) return 'out-of-range';
  return t;
}

/** Knock on a door: noise (zombies hear it), event; instant. */
export function knock(w: SimWorld, eid: number, key: number): CommandRejectReason | undefined {
  const k = unpackKey(key);
  const t = edgeAt(gridOf(w), w, key % 2, k.tx, k.ty, k.z);
  if (t.kind !== OpeningKind.door && t.kind !== OpeningKind.gate) return 'invalid-target';
  if (!edgeInReach(w, eid, key)) return 'out-of-range';
  const c = edgeCentre(key % 2, k.tx, k.ty);
  const n = locksCfg(w)?.knockNoise ?? { radiusTiles: 6, volume: 0.4 };
  emitNoise(w, c.x, c.y, k.z, n.radiusTiles, n.volume, 'action', 0, { eid, kind: 'knock' });
  w.events.push({
    type: 'knocked',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    tx: k.tx,
    ty: k.ty,
    z: k.z,
    side: k.side,
  });
  return undefined;
}

let registered = false;

export function registerLockActions(): void {
  if (registered) return;
  registered = true;

  // Lock / unlock with the building key (`a.method` 'lock' | 'unlock').
  registerAction('useKey', {
    validate(w, eid, a) {
      const t = door(w, eid, a);
      if (typeof t === 'string') return t;
      if (t.planks > 0) return 'invalid-state';
      if (a.method === 'unlock' ? t.state !== OS.locked : t.state !== OS.closed)
        return 'invalid-state';
      if (!keyFor(w, eid, doorBuilding(w, a.edge!))) return 'no-key';
      return undefined;
    },
    durationMin: (w) => secMin(w, locksCfg(w)?.keySec ?? 1),
    complete(w, eid, a) {
      const t = door(w, eid, a) as Door;
      setOpening(w.openings, t.key, t.kind, a.method === 'unlock' ? OS.closed : OS.locked, t.e?.hp);
      emitOpeningChanged(w, t.key, t.kind, 'player');
    },
  });

  // Pick the lock with `a.item` (tag `locks.lockpick.tag`).
  registerAction('pickLock', {
    validate(w, eid, a) {
      const t = door(w, eid, a);
      if (typeof t === 'string') return t;
      if (t.planks > 0 || t.state !== OS.locked) return 'invalid-state';
      const st = w.items!;
      const item = st.items.get(a.item);
      const p = playerItems(w, eid);
      const tag = locksCfg(w)?.lockpick.tag ?? 'base:lockpick';
      if (!item || !p || !defOf(st, item).tags.includes(tag)) return 'missing-item';
      if (!carriedItems(st, p.inventory).includes(item)) return 'missing-item';
      return undefined;
    },
    durationMin: (w) => secMin(w, locksCfg(w)?.lockpick.sec ?? 8),
    begin(w, eid, a) {
      const lp = locksCfg(w)?.lockpick;
      const k = unpackKey(a.edge!);
      const c = edgeCentre(a.edge! % 2, k.tx, k.ty);
      if (lp)
        emitNoise(w, c.x, c.y, k.z, lp.noise.radiusTiles, lp.noise.volume, 'action', 0, {
          eid,
          kind: 'lockpick',
        });
    },
    complete(w, eid, a) {
      const st = w.items!;
      const t = door(w, eid, a) as Door;
      const lp = locksCfg(w).lockpick;
      const item = st.items.get(a.item)!;
      const def = defOf(st, item).id;
      const success = w.rng.actions.nextFloat() < lockpickChance(w, eid);
      let broke = false;
      if (success) {
        setOpening(w.openings, t.key, t.kind, OS.closed, t.e?.hp);
        emitOpeningChanged(w, t.key, t.kind, 'player');
      } else if (w.rng.actions.nextFloat() < lp.breakChance) {
        broke = true;
        if (item.count > 1) item.count--;
        else destroyItem(st, item);
        st.version++;
      }
      addXp(w, eid, lp.skill, lp.xp);
      const k = unpackKey(t.key);
      w.events.push({
        type: 'lockPicked',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        tx: k.tx,
        ty: k.ty,
        z: k.z,
        side: k.side,
        item: def,
        success,
        broke,
      });
    },
  });
}
