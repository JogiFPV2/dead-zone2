import type { Command, CommandRejectReason } from '@deadzone/protocol';
import { emitNoise } from '../ai/noise.js';
import type { AiWorld } from '../ai/state.js';
import { secToTicks } from '../ai/zombies.js';
import { gameMinuteAt } from '../core/clock.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import type { ItemDef } from '../content/adapter.js';
import { carriedItems } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import {
  createItem,
  defOf,
  destroyItem,
  type ItemInstance,
  type ItemStore,
} from '../items/store.js';
import { Pen, penaltyMul } from '../survival/penalties.js';
import { addXp, skillLevel } from '../progress/skills.js';
import type { TileGrid } from '../world/grid.js';
import { lineOfSight } from '../world/los.js';
import type { CombatWorld } from './state.js';
import { damageZombie } from './system.js';

type RangedDef = Extract<ItemDef, { kind: 'weapon_ranged' }>;
type MagazineDef = Extract<ItemDef, { kind: 'magazine' }>;

/** Firearm in `hand_primary` (undefined: none). */
export function firearmOf(
  w: SimWorld,
  eid: number,
): { item: ItemInstance; def: RangedDef } | undefined {
  const st = w.items;
  const p = st?.players.get(w.c.StableId.value[eid] ?? 0);
  const id = p?.slots.get('hand_primary');
  const item = id === undefined ? undefined : st?.items.get(id);
  if (!st || !item) return undefined;
  const def = defOf(st, item);
  return def.kind === 'weapon_ranged' ? { item, def } : undefined;
}

/** Rounds the firearm holds at most (internal feed, or the inserted magazine; 0 = none). */
export function capacityOf(st: ItemStore, item: ItemInstance, def: RangedDef): number {
  if (def.ranged.feed.type === 'internal') return def.ranged.feed.capacity;
  const mag = st.magOf.get(item.id);
  const md = mag === undefined ? undefined : st.content.items[mag];
  return md?.kind === 'magazine' ? md.magazine.capacity : 0;
}

const carriedOf = (w: SimWorld, eid: number, defId: string): ItemInstance[] => {
  const st = w.items!;
  const p = playerItems(w, eid);
  return p ? carriedItems(st, p.inventory).filter((i) => defOf(st, i).id === defId) : [];
};

const countOf = (items: ItemInstance[]): number => items.reduce((n, i) => n + i.count, 0);

/** Removes `n` rounds from the carried stacks (in inventory order). */
function takeRounds(w: SimWorld, items: ItemInstance[], n: number): number {
  const st = w.items!;
  let left = n;
  for (const it of items) {
    if (left === 0) break;
    const k = Math.min(left, it.count);
    left -= k;
    if (k === it.count) destroyItem(st, it);
    else {
      it.count -= k;
      st.version++;
    }
  }
  return n - left;
}

/** The fullest carried magazine for this weapon (lowest id on ties). */
function bestMagazine(w: SimWorld, eid: number, magId: string): ItemInstance | undefined {
  let best: ItemInstance | undefined;
  for (const m of carriedOf(w, eid, magId)) {
    if (m.uses > 0 && (!best || m.uses > best.uses)) best = m;
  }
  return best;
}

/** `attack` with a firearm: checks before queueing the shot. */
export function canShoot(w: SimWorld, eid: number): CommandRejectReason | undefined {
  const g = firearmOf(w, eid);
  if (!g) return undefined;
  const cb = w.ai!.combat;
  if ((cb.reloadUntil[eid] ?? 0) > w.tick) return 'busy';
  if (w.items!.jammed.has(g.item.id)) return 'invalid-state';
  if (g.item.uses <= 0) return 'no-ammo';
  return undefined;
}

function reloadEvent(
  w: SimWorld,
  eid: number,
  item: ItemInstance,
  phase: 'started' | 'done' | 'cancelled',
  untilTick: number,
): void {
  w.events.push({
    type: 'reload',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    item: item.id,
    def: defOf(w.items!, item).id,
    phase,
    untilTick,
    ammo: item.uses,
  });
}

/** `reload` / `loadMagazine` (timed in combat state; not a queued action, threat does not stop it). */
export function applyFirearmCommand(
  w: SimWorld,
  eid: number,
  cmd: Extract<Command, { type: 'reload' | 'loadMagazine' }>,
): CommandRejectReason | undefined {
  const st = w.items;
  const cb = w.ai?.combat;
  if (!st || !cb || !playerItems(w, eid)) return 'invalid-state';
  if (w.survival?.asleep[eid]) return 'invalid-state';
  if ((cb.reloadUntil[eid] ?? 0) > w.tick) return 'busy';
  const speed = Math.max(0.1, penaltyMul(w, eid, Pen.action));
  let item: ItemInstance;
  let sec: number;
  if (cmd.type === 'reload') {
    const g = firearmOf(w, eid);
    if (!g) return 'invalid-target';
    item = g.item;
    const jammed = st.jammed.has(item.id);
    const feed = g.def.ranged.feed;
    if (feed.type === 'internal') {
      const room = feed.capacity - item.uses;
      if (!jammed && (room <= 0 || countOf(carriedOf(w, eid, g.def.ranged.ammo)) === 0))
        return room <= 0 ? 'invalid-state' : 'no-ammo';
    } else if (!jammed && !bestMagazine(w, eid, feed.magazine)) return 'no-ammo';
    const red = cb.cfg.firearms.reloadTimeReductionPerLevel * skillLevel(w, eid, 'base:reloading');
    sec = g.def.ranged.reloadSec * Math.max(0.5, 1 - red);
  } else {
    const found = st.items.get(cmd.item);
    const p = playerItems(w, eid)!;
    if (!found || !carriedItems(st, p.inventory).includes(found)) return 'no-item';
    const def = defOf(st, found);
    if (def.kind !== 'magazine') return 'invalid-target';
    const room = def.magazine.capacity - found.uses;
    if (room <= 0) return 'invalid-state';
    const have = countOf(carriedOf(w, eid, def.magazine.ammo));
    if (have === 0) return 'no-ammo';
    item = found;
    sec = Math.min(room, have) * cb.cfg.firearms.magazineLoadSecPerRound;
  }
  cb.reloadUntil[eid] = w.tick + secToTicks(sec / speed);
  cb.reloadItem[eid] = item.id;
  reloadEvent(w, eid, item, 'started', cb.reloadUntil[eid] ?? 0);
  return undefined;
}

/** Finishes reloads due this tick (combat step). */
export function reloadSystem(w: SimWorld, cb: CombatWorld): void {
  const st = w.items;
  if (!st) return;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    const until = cb.reloadUntil[eid] ?? 0;
    if (until === 0 || w.tick < until) continue;
    cb.reloadUntil[eid] = 0;
    const item = st.items.get(cb.reloadItem[eid] ?? 0);
    cb.reloadItem[eid] = 0;
    if (!item) continue;
    const def = defOf(st, item);
    const p = playerItems(w, eid);
    if (!p || w.survival?.dead[eid]) continue;
    if (def.kind === 'magazine') {
      if (!carriedItems(st, p.inventory).includes(item)) {
        reloadEvent(w, eid, item, 'cancelled', 0);
        continue;
      }
      fillMagazine(w, eid, item, def);
      reloadEvent(w, eid, item, 'done', 0);
      continue;
    }
    const g = firearmOf(w, eid);
    if (!g || g.item !== item) {
      reloadEvent(w, eid, item, 'cancelled', 0);
      continue;
    }
    st.jammed.delete(item.id);
    const feed = g.def.ranged.feed;
    if (feed.type === 'internal') {
      const rounds = carriedOf(w, eid, g.def.ranged.ammo);
      item.uses += takeRounds(w, rounds, Math.max(0, feed.capacity - item.uses));
    } else {
      const mag = bestMagazine(w, eid, feed.magazine);
      if (mag) swapMagazine(w, p.inventory, item, mag);
    }
    st.version++;
    addXp(w, eid, 'base:reloading', cb.cfg.firearms.xpPerReload);
    reloadEvent(w, eid, item, 'done', 0);
  }
}

function fillMagazine(w: SimWorld, eid: number, mag: ItemInstance, def: MagazineDef): void {
  const rounds = carriedOf(w, eid, def.magazine.ammo);
  mag.uses += takeRounds(w, rounds, Math.max(0, def.magazine.capacity - mag.uses));
  w.items!.version++;
}

/** Ejects the inserted magazine (as an item with the rounds left) and inserts `mag`. */
function swapMagazine(w: SimWorld, inventory: number, gun: ItemInstance, mag: ItemInstance): void {
  const st = w.items!;
  const old = st.magOf.get(gun.id);
  if (old !== undefined) {
    const out = createItem(st, old, inventory, 1, gameMinuteAt(w.clock, w.tick));
    out.uses = gun.uses;
  }
  st.magOf.set(gun.id, mag.def);
  gun.uses = mag.uses;
  destroyItem(st, mag);
}

/** Point at distance `t` along the ray before the first wall (binary search on sight). */
function rayEnd(
  grid: TileGrid,
  z: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  t: number,
): number {
  if (lineOfSight(grid, z, x, y, x + dx * t, y + dy * t)) return t;
  let lo = 0;
  let hi = t;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (lineOfSight(grid, z, x, y, x + dx * mid, y + dy * mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * One shot (combat step, after `attack` passed `canShoot`): noise `ranged.shotNoise`, one ray
 * per projectile with spread, the first zombie on each ray rolls the hit (accuracy falls with
 * distance and arm wounds), damage per projectile × ammo `damageMultiplier`; jam and wear rolls.
 */
export function fire(w: SimWorld, ai: AiWorld, cb: CombatWorld, grid: TileGrid, eid: number): void {
  const g = firearmOf(w, eid);
  const st = w.items;
  if (!g || !st || g.item.uses <= 0) return;
  const r = g.def.ranged;
  const fc = cb.cfg.firearms;
  const rng = w.rng.combat;
  const { Position, AimIntent, Collider, StableId, Velocity } = w.c;
  const x = Position.x[eid] ?? 0;
  const y = Position.y[eid] ?? 0;
  const z = Position.z[eid] ?? 0;
  cb.readyTick[eid] = w.tick + secToTicks(1 / r.shotsPerSec);
  cb.swingTick[eid] = w.tick;
  g.item.uses--;
  st.version++;
  emitNoise(w, x, y, z, r.shotNoise.radiusTiles, r.shotNoise.volume, 'shot');
  let ax = 1;
  let ay = 0;
  {
    let dx = AimIntent.active[eid] ? (AimIntent.x[eid] ?? 0) - x : (Velocity.x[eid] ?? 0);
    let dy = AimIntent.active[eid] ? (AimIntent.y[eid] ?? 0) - y : (Velocity.y[eid] ?? 0);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1e-6) {
      dx /= len;
      dy /= len;
      ax = dx;
      ay = dy;
    }
  }
  const ammoDef = st.content.items[st.content.itemIndex.get(r.ammo) ?? -1];
  const ammoMul = ammoDef?.kind === 'ammo' ? ammoDef.ammo.damageMultiplier : 1;
  const aimMul =
    penaltyMul(w, eid, Pen.attack) * (1 + fc.accuracyPerSkillLevel * skillLevel(w, eid, r.skill));
  let hits = 0;
  const zombies = sortedQuery(w, 'zombies', [w.c.Zombie]).filter(
    (zid) => (Position.z[zid] ?? 0) === z,
  );
  const rays: { toX: number; toY: number; hit: number }[] = [];
  for (let p = 0; p < r.projectiles; p++) {
    const off = (rng.nextFloat() * 2 - 1) * fc.spread[r.category];
    let dx = ax - ay * off;
    let dy = ay + ax * off;
    const len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;
    const end = rayEnd(grid, z, x, y, dx, dy, r.rangeTiles);
    // Zombies along the ray, nearest first.
    const along: { zid: number; t: number }[] = [];
    for (const zid of zombies) {
      const qx = (Position.x[zid] ?? 0) - x;
      const qy = (Position.y[zid] ?? 0) - y;
      const t = qx * dx + qy * dy;
      if (t <= 0 || t > end) continue;
      const px = qx - dx * t;
      const py = qy - dy * t;
      const rr = (Collider.radius[zid] ?? 0) + fc.projectileRadiusTiles;
      if (px * px + py * py <= rr * rr) along.push({ zid, t });
    }
    along.sort((a, b) => a.t - b.t || (StableId.value[a.zid] ?? 0) - (StableId.value[b.zid] ?? 0));
    let hit = 0;
    let tEnd = end;
    for (const a of along) {
      if ((w.c.Zombie.hp[a.zid] ?? 0) <= 0) continue; // killed by an earlier projectile
      const chance = r.accuracy * (1 - (fc.hitFalloffAtRange * a.t) / r.rangeTiles) * aimMul;
      if (!rng.chance(Math.max(0, chance))) continue;
      const dmg = Math.fround(
        (r.damage.min + rng.nextFloat() * (r.damage.max - r.damage.min)) * ammoMul,
      );
      hit = StableId.value[a.zid] ?? 0;
      tEnd = a.t;
      hits++;
      damageZombie(w, ai, cb, grid, a.zid, eid, dmg, 'shot');
      break;
    }
    rays.push({
      toX: Math.round((x + dx * tEnd) * 100) / 100,
      toY: Math.round((y + dy * tEnd) * 100) / 100,
      hit,
    });
  }
  if (hits > 0) addXp(w, eid, r.skill, fc.xpPerHit);
  let jammed = false;
  if (r.jamChance > 0 && g.item.uses > 0 && rng.chance(r.jamChance)) {
    st.jammed.add(g.item.id);
    jammed = true;
  }
  if (r.durability.lossChancePerUse > 0 && rng.chance(r.durability.lossChancePerUse)) {
    g.item.condition = Math.max(0, g.item.condition - 1);
    if (g.item.condition === 0) {
      st.jammed.delete(g.item.id);
      st.magOf.delete(g.item.id);
      destroyItem(st, g.item);
      w.events.push({
        type: 'weaponBroke',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        itemId: g.def.id,
      });
    }
  }
  w.events.push({
    type: 'shot',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    weapon: g.def.id,
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    rays,
    ammo: g.item.uses,
    jammed,
  });
}
