import {
  GAITS,
  RELOAD_KINDS,
  type Command,
  type CommandRejectReason,
  type ReloadKind,
} from '@deadzone/protocol';
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
import { RK, type CombatWorld } from './state.js';
import { damageZombie } from './system.js';
import { floorZ } from '../world/levels.js';
import { physicsHit } from '../physics/system.js';
import type { FirearmKnockback } from '../physics/constants.js';
import { damageAnimal } from '../animals/damage.js';
import { isLiveAnimal } from '../animals/state.js';

type RangedDef = Extract<ItemDef, { kind: 'weapon_ranged' }>;
type MagazineDef = Extract<ItemDef, { kind: 'magazine' }>;

/**
 * Knock-back force of one projectile hit at distance `t` (tiles): full up to `closeTiles`, then
 * linearly down to × `minMul`; split between the pellets of a shot.
 */
export function shotForce(k: FirearmKnockback, t: number, projectiles: number): number {
  const fall = t <= k.closeTiles ? 1 : Math.max(k.minMul, 1 - (t - k.closeTiles) / k.falloffTiles);
  return (k.force * fall) / Math.max(1, projectiles);
}

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

/** Single-round loading step of the gun (ticks before the action-speed penalty), 0 = whole at once. */
function roundLoadSec(def: RangedDef): number {
  const r = def.ranged;
  return r.feed.type === 'internal' && r.loadSecPerRound !== undefined && r.loadSecPerRound > 0
    ? r.loadSecPerRound
    : 0;
}

/** Reload time × skill (`base:reloading`) ÷ action-speed penalty → ticks. */
function reloadTicks(
  w: SimWorld,
  cb: CombatWorld,
  eid: number,
  sec: number,
  skill: boolean,
): number {
  const speed = Math.max(0.1, penaltyMul(w, eid, Pen.action));
  const red = skill
    ? cb.cfg.firearms.reloadTimeReductionPerLevel * skillLevel(w, eid, 'base:reloading')
    : 0;
  return secToTicks((sec * Math.max(0.5, 1 - red)) / speed);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Effective spread (rad) of the firearm `def` held by `eid` right now: category base ×
 * min(max, 1 + moving × move + running × run + exhaustion × (1 − endurance) + fatigue + panic)
 * (`worldSettings.firearms.spreadModifiers`). Move = speed / walking speed (0..1, from the
 * velocity of the last movement step); run = the same while the effective gait is `run`.
 * Used by `fire` and by the view `combat.spread`.
 */
export function effectiveSpread(w: SimWorld, cb: CombatWorld, eid: number, def: RangedDef): number {
  const fc = cb.cfg.firearms;
  const m = fc.spreadModifiers;
  const base = fc.spread[def.ranged.category];
  const { Velocity, MoveStats, MoveIntent } = w.c;
  const vx = Velocity.x[eid] ?? 0;
  const vy = Velocity.y[eid] ?? 0;
  const walk = MoveStats.speedPerTick[eid] ?? 0;
  const move = walk > 0 ? clamp01(Math.sqrt(vx * vx + vy * vy) / walk) : 0;
  const running = GAITS[MoveIntent.gait[eid] ?? 1] === 'run' ? move : 0;
  let mul = 1 + m.moving * move + m.running * running;
  const s = w.survival;
  if (s) {
    mul += m.exhaustion * clamp01(1 - (s.vitals.endurance[eid] ?? 100) / 100);
    mul += m.fatigue * clamp01((s.vitals.fatigue[eid] ?? 0) / 100);
    mul += m.panic * clamp01((s.vitals.panic[eid] ?? 0) / 100);
  }
  return Math.fround(base * Math.min(m.max, mul));
}

/** Reload kind of `eid` (undefined: none in progress). */
export function reloadKindOf(cb: CombatWorld, eid: number): ReloadKind | undefined {
  const k = cb.reloadKind[eid] ?? 0;
  return cb.reloadUntil[eid] && k > 0 ? RELOAD_KINDS[k - 1] : undefined;
}

/** Progress 0..1 of the current reload step at `tick` (undefined: none). */
export function reloadProgressOf(cb: CombatWorld, eid: number, tick: number): number | undefined {
  const until = cb.reloadUntil[eid] ?? 0;
  if (!until) return undefined;
  const start = cb.reloadStart[eid] ?? 0;
  if (until <= start) return 1;
  return clamp01((tick - start) / (until - start));
}

function clearReload(cb: CombatWorld, eid: number): void {
  cb.reloadUntil[eid] = 0;
  cb.reloadItem[eid] = 0;
  cb.reloadStart[eid] = 0;
  cb.reloadKind[eid] = RK.none;
}

/**
 * `attack` interrupts single-round loading (rounds loaded so far stay); called before the
 * shot checks, so the shot then goes through with what is loaded.
 */
export function interruptSingleLoad(w: SimWorld, eid: number): void {
  const cb = w.ai?.combat;
  const st = w.items;
  if (!cb || !st || cb.reloadKind[eid] !== RK.single || (cb.reloadUntil[eid] ?? 0) <= w.tick)
    return;
  const item = st.items.get(cb.reloadItem[eid] ?? 0);
  clearReload(cb, eid);
  if (item) reloadEvent(w, eid, item, 'cancelled', 0, RK.single);
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
  phase: 'started' | 'round' | 'done' | 'cancelled',
  untilTick: number,
  kind: number,
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
    kind: RELOAD_KINDS[kind - 1] ?? 'magazine',
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
  let item: ItemInstance;
  let ticks: number;
  let kind: number;
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
    const perRound = roundLoadSec(g.def);
    kind = jammed ? RK.unjam : perRound > 0 ? RK.single : RK.magazine;
    ticks = reloadTicks(w, cb, eid, kind === RK.single ? perRound : g.def.ranged.reloadSec, true);
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
    const sec = Math.min(room, have) * cb.cfg.firearms.magazineLoadSecPerRound;
    ticks = reloadTicks(w, cb, eid, sec, false);
    kind = RK.loadMagazine;
  }
  startStep(cb, eid, item, w.tick, ticks, kind);
  reloadEvent(w, eid, item, 'started', cb.reloadUntil[eid] ?? 0, kind);
  return undefined;
}

function startStep(
  cb: CombatWorld,
  eid: number,
  item: ItemInstance,
  tick: number,
  ticks: number,
  kind: number,
): void {
  cb.reloadStart[eid] = tick;
  // At least one tick, so a step always shows up as "in progress".
  cb.reloadUntil[eid] = tick + Math.max(1, ticks);
  cb.reloadItem[eid] = item.id;
  cb.reloadKind[eid] = kind;
}

/** Finishes reloads due this tick (combat step). */
export function reloadSystem(w: SimWorld, cb: CombatWorld): void {
  const st = w.items;
  if (!st) return;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    const until = cb.reloadUntil[eid] ?? 0;
    if (until === 0 || w.tick < until) continue;
    const kind = cb.reloadKind[eid] || RK.magazine;
    const item = st.items.get(cb.reloadItem[eid] ?? 0);
    clearReload(cb, eid);
    if (!item) continue;
    const def = defOf(st, item);
    const p = playerItems(w, eid);
    if (!p || w.survival?.dead[eid]) continue;
    if (def.kind === 'magazine') {
      if (!carriedItems(st, p.inventory).includes(item)) {
        reloadEvent(w, eid, item, 'cancelled', 0, kind);
        continue;
      }
      fillMagazine(w, eid, item, def);
      reloadEvent(w, eid, item, 'done', 0, kind);
      continue;
    }
    const g = firearmOf(w, eid);
    if (!g || g.item !== item) {
      reloadEvent(w, eid, item, 'cancelled', 0, kind);
      continue;
    }
    st.jammed.delete(item.id);
    const feed = g.def.ranged.feed;
    if (kind === RK.single && feed.type === 'internal') {
      const rounds = carriedOf(w, eid, g.def.ranged.ammo);
      const took = takeRounds(w, rounds, item.uses < feed.capacity ? 1 : 0);
      item.uses += took;
      st.version++;
      const more = item.uses < feed.capacity && countOf(carriedOf(w, eid, g.def.ranged.ammo)) > 0;
      if (more) {
        const ticks = reloadTicks(w, cb, eid, roundLoadSec(g.def), true);
        startStep(cb, eid, item, w.tick, ticks, RK.single);
      }
      if (took > 0) reloadEvent(w, eid, item, 'round', cb.reloadUntil[eid] ?? 0, kind);
      if (more) continue;
      addXp(w, eid, 'base:reloading', cb.cfg.firearms.xpPerReload);
      reloadEvent(w, eid, item, 'done', 0, kind);
      continue;
    }
    if (kind === RK.unjam && roundLoadSec(g.def) > 0) {
      // Single-round guns: clearing the jam is its own step (then `reload` loads rounds).
      st.version++;
      reloadEvent(w, eid, item, 'done', 0, kind);
      continue;
    }
    if (feed.type === 'internal') {
      const rounds = carriedOf(w, eid, g.def.ranged.ammo);
      item.uses += takeRounds(w, rounds, Math.max(0, feed.capacity - item.uses));
    } else {
      const mag = bestMagazine(w, eid, feed.magazine);
      if (mag) swapMagazine(w, p.inventory, item, mag);
    }
    st.version++;
    addXp(w, eid, 'base:reloading', cb.cfg.firearms.xpPerReload);
    reloadEvent(w, eid, item, 'done', 0, kind);
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
  const z = floorZ(w, eid);
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
  const spread = effectiveSpread(w, cb, eid, g.def);
  let hits = 0;
  // Zombies and living animals (hunting) on the shooter's floor.
  const zombies = sortedQuery(w, 'zombies', [w.c.Zombie]).filter((zid) => floorZ(w, zid) === z);
  if (ai.animalCount > 0) {
    for (const aid of sortedQuery(w, 'animals', [w.c.Animal])) {
      if (isLiveAnimal(w, aid) && floorZ(w, aid) === z) zombies.push(aid);
    }
  }
  const rays: { toX: number; toY: number; hit: number }[] = [];
  // Knock-back per zombie hit by this shot (pellets add up), applied after all rays.
  const kb = w.physics.cfg.firearms[r.category];
  const pushes = new Map<number, { force: number; killed: boolean }>();
  for (let p = 0; p < r.projectiles; p++) {
    const off = (rng.nextFloat() * 2 - 1) * spread;
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
      const animal = w.c.Animal.is[a.zid] === 1;
      // Killed by an earlier projectile.
      if (animal ? !isLiveAnimal(w, a.zid) : (w.c.Zombie.hp[a.zid] ?? 0) <= 0) continue;
      const chance = r.accuracy * (1 - (fc.hitFalloffAtRange * a.t) / r.rangeTiles) * aimMul;
      if (!rng.chance(Math.max(0, chance))) continue;
      const dmg = Math.fround(
        (r.damage.min + rng.nextFloat() * (r.damage.max - r.damage.min)) * ammoMul,
      );
      hit = StableId.value[a.zid] ?? 0;
      tEnd = a.t;
      hits++;
      if (animal) {
        // Animals have no physics body (no knock-back).
        damageAnimal(w, ai, grid, a.zid, eid, dmg, 'shot');
      } else {
        const killed = damageZombie(w, ai, cb, grid, a.zid, eid, dmg, 'shot');
        const p = pushes.get(a.zid) ?? { force: 0, killed: false };
        p.force += shotForce(kb, a.t, r.projectiles);
        p.killed ||= killed;
        pushes.set(a.zid, p);
      }
      break;
    }
    rays.push({
      toX: Math.round((x + dx * tEnd) * 100) / 100,
      toY: Math.round((y + dy * tEnd) * 100) / 100,
      hit,
    });
  }
  // Map order = first hit order (deterministic): one physics hit per zombie (2 physics draws).
  for (const [zid, p] of pushes) {
    physicsHit(w, eid, zid, 'shot', Math.fround(Math.min(1, p.force)), p.killed, kb.maxReaction);
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
