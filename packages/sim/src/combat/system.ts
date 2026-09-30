import { BODY_PARTS, type HitSource } from '@deadzone/protocol';
import { emitNoise } from '../ai/noise.js';
import { ZombieState, type AiWorld } from '../ai/state.js';
import { secToTicks } from '../ai/zombies.js';
import { atan2Bam } from '../core/dmath.js';
import { detach, sortedQuery, type SimWorld } from '../core/world.js';
import { defOf, destroyItem } from '../items/store.js';
import { clampStat, deathCauseIndex, woundKindIndex } from '../survival/state.js';
import { inflictWound } from '../survival/wounds.js';
import { lineOfSight, walkableLine } from '../world/los.js';
import type { TileGrid } from '../world/grid.js';
import type { CombatWorld } from './state.js';

/**
 * Pipeline `combat` (docs 2.5): player swings and shoves queued by `attack` / `shove` this tick
 * (in command order), then zombie attacks (StableId order). Randomness only from `rng.combat`.
 */
export function combatSystem(w: SimWorld, grid: TileGrid): void {
  const ai = w.ai;
  if (!ai) return;
  const cb = ai.combat;
  for (const p of cb.pending) {
    if (w.survival?.dead[p.eid]) continue;
    if (p.shove) shove(w, ai, cb, grid, p.eid);
    else swing(w, ai, cb, grid, p.eid);
  }
  cb.pending.length = 0;
  if (ai.zombieCount > 0) zombieAttacks(w, ai, cb, grid);
}

/** Melee stats of the weapon in `hand_primary` (bare hands without one). */
export interface MeleeStats {
  item: number | undefined;
  damage: { min: number; max: number };
  rangeTiles: number;
  attacksPerSec: number;
  staminaCost: number;
  critChance: number;
  knockback: number;
  maxTargets: number;
  noise: { radiusTiles: number; volume: number };
  lossChancePerUse: number;
}

export function meleeOf(w: SimWorld, cb: CombatWorld, eid: number): MeleeStats {
  const st = w.items;
  const p = st?.players.get(w.c.StableId.value[eid] ?? 0);
  const id = p?.slots.get('hand_primary');
  const item = id === undefined ? undefined : st?.items.get(id);
  if (st && item) {
    const def = defOf(st, item);
    if (def.kind === 'weapon_melee') {
      const m = def.melee;
      return {
        item: item.id,
        damage: m.damage,
        rangeTiles: m.rangeTiles,
        attacksPerSec: m.attacksPerSec,
        staminaCost: m.staminaCost,
        critChance: m.critChance,
        knockback: m.knockback,
        maxTargets: m.maxTargets,
        noise: m.hitNoise ?? cb.cfg.attackNoise,
        lossChancePerUse: m.durability.lossChancePerUse,
      };
    }
  }
  const u = cb.cfg.unarmed;
  return {
    item: undefined,
    ...u,
    critChance: 0,
    maxTargets: 1,
    noise: cb.cfg.attackNoise,
    lossChancePerUse: 0,
  };
}

/** Zombies in the swing cone within `range` (+ their radius) and in sight, nearest first. */
function targetsInArc(
  w: SimWorld,
  ai: AiWorld,
  cb: CombatWorld,
  grid: TileGrid,
  eid: number,
  range: number,
): { eid: number; d2: number }[] {
  const { Position, Facing, Collider, StableId } = w.c;
  const x = Position.x[eid] ?? 0;
  const y = Position.y[eid] ?? 0;
  const z = Position.z[eid] ?? 0;
  const face = Facing.angle[eid] ?? 0;
  const half = Math.round((cb.cfg.arcHalfDeg / 360) * 65536);
  const out: { eid: number; d2: number }[] = [];
  for (const zid of sortedQuery(w, 'zombies', [w.c.Zombie])) {
    if ((Position.z[zid] ?? 0) !== z) continue;
    const dx = (Position.x[zid] ?? 0) - x;
    const dy = (Position.y[zid] ?? 0) - y;
    const r = range + (Collider.radius[zid] ?? 0);
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r) continue;
    if (d2 > 1e-6) {
      const diff = (atan2Bam(dy, dx) - face) & 0xffff;
      if (Math.min(diff, 65536 - diff) > half) continue;
    }
    if (!lineOfSight(grid, z, x, y, Position.x[zid] ?? 0, Position.y[zid] ?? 0)) continue;
    out.push({ eid: zid, d2 });
  }
  out.sort((a, b) => a.d2 - b.d2 || (StableId.value[a.eid] ?? 0) - (StableId.value[b.eid] ?? 0));
  void ai;
  return out;
}

/** Spends stamina; returns true when the player was exhausted (endurance below the cost). */
function spendStamina(w: SimWorld, eid: number, cost: number): boolean {
  const s = w.survival;
  if (!s) return false;
  const e = s.vitals.endurance[eid] ?? 0;
  s.vitals.endurance[eid] = clampStat(e - cost);
  return e < cost;
}

function swing(w: SimWorld, ai: AiWorld, cb: CombatWorld, grid: TileGrid, eid: number): void {
  const cfg = cb.cfg;
  const m = meleeOf(w, cb, eid);
  const exhausted = spendStamina(w, eid, m.staminaCost);
  const cooldown = secToTicks(1 / m.attacksPerSec / (exhausted ? cfg.exhaustedDamageMul : 1));
  cb.readyTick[eid] = w.tick + cooldown;
  cb.swingTick[eid] = w.tick;
  const { Position, StableId } = w.c;
  const x = Position.x[eid] ?? 0;
  const y = Position.y[eid] ?? 0;
  const z = Position.z[eid] ?? 0;
  const rng = w.rng.combat;
  const targets = targetsInArc(w, ai, cb, grid, eid, m.rangeTiles).slice(0, m.maxTargets);
  for (const t of targets) {
    let dmg = m.damage.min + rng.nextFloat() * (m.damage.max - m.damage.min);
    if (m.critChance > 0 && rng.chance(m.critChance)) dmg *= cfg.critMul;
    if (exhausted) dmg *= cfg.exhaustedDamageMul;
    dmg = Math.fround(dmg);
    const killed = damageZombie(w, ai, cb, grid, t.eid, eid, dmg, 'melee');
    if (!killed && m.knockback > 0) {
      push(w, grid, eid, t.eid, cfg.knockbackTiles * m.knockback);
      cb.staggerUntil[t.eid] = w.tick + secToTicks(cfg.staggerSecPerKnockback * m.knockback);
    }
  }
  emitNoise(w, x, y, z, m.noise.radiusTiles, m.noise.volume, 'attack');
  if (targets.length > 0 && m.item !== undefined && m.lossChancePerUse > 0) wear(w, eid, m.item);
  void StableId;
}

function shove(w: SimWorld, ai: AiWorld, cb: CombatWorld, grid: TileGrid, eid: number): void {
  const sc = cb.cfg.shove;
  spendStamina(w, eid, sc.staminaCost);
  cb.readyTick[eid] = w.tick + secToTicks(sc.cooldownSec);
  cb.swingTick[eid] = w.tick;
  for (const t of targetsInArc(w, ai, cb, grid, eid, sc.rangeTiles)) {
    push(w, grid, eid, t.eid, sc.pushTiles);
    cb.staggerUntil[t.eid] = w.tick + secToTicks(sc.staggerSec);
    hitEvent(w, 'shove', eid, t.eid, 0, false);
  }
}

/** Pushes `target` away from `from` by up to `dist` tiles along a walkable straight line. */
function push(w: SimWorld, grid: TileGrid, from: number, target: number, dist: number): void {
  const { Position, Collider } = w.c;
  const x = Position.x[target] ?? 0;
  const y = Position.y[target] ?? 0;
  const z = Position.z[target] ?? 0;
  let dx = x - (Position.x[from] ?? 0);
  let dy = y - (Position.y[from] ?? 0);
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return;
  dx /= len;
  dy /= len;
  const r = Collider.radius[target] ?? 0;
  // Halve the push until the line (plus the collider radius) is free of edges.
  for (let d = dist; d > 0.05; d *= 0.5) {
    if (walkableLine(grid, z, x, y, x + dx * (d + r), y + dy * (d + r))) {
      Position.x[target] = Math.fround(x + dx * d);
      Position.y[target] = Math.fround(y + dy * d);
      return;
    }
  }
}

function wear(w: SimWorld, eid: number, itemId: number): void {
  const st = w.items;
  const item = st?.items.get(itemId);
  if (!st || !item) return;
  const def = defOf(st, item);
  if (def.kind !== 'weapon_melee') return;
  if (!w.rng.combat.chance(def.melee.durability.lossChancePerUse)) return;
  item.condition = Math.max(0, item.condition - 1);
  st.version++;
  if (item.condition > 0) return;
  destroyItem(st, item);
  w.events.push({
    type: 'weaponBroke',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    itemId: def.id,
  });
}

function hitEvent(
  w: SimWorld,
  source: HitSource,
  attacker: number,
  target: number,
  damage: number,
  killed: boolean,
): void {
  const { StableId, Position } = w.c;
  w.events.push({
    type: 'hit',
    tick: w.tick,
    source,
    attacker: StableId.value[attacker] ?? 0,
    target: StableId.value[target] ?? 0,
    damage,
    x: Position.x[target] ?? 0,
    y: Position.y[target] ?? 0,
    killed,
  });
}

/** Applies damage to a zombie; returns true when it died. A hit makes it chase the attacker. */
export function damageZombie(
  w: SimWorld,
  ai: AiWorld,
  cb: CombatWorld,
  grid: TileGrid,
  zid: number,
  attacker: number,
  dmg: number,
  source: HitSource,
): boolean {
  const { Zombie, StableId } = w.c;
  const hp = Math.fround((Zombie.hp[zid] ?? 0) - dmg);
  Zombie.hp[zid] = hp > 0 ? hp : 0;
  const killed = hp <= 0;
  hitEvent(w, source, attacker, zid, dmg, killed);
  if (!killed) {
    // Hurt zombies turn on the attacker.
    Zombie.state[zid] = ZombieState.chase;
    Zombie.targetId[zid] = StableId.value[attacker] ?? 0;
    Zombie.memoryUntil[zid] = w.tick + secToTicks(ai.cfg.ai.memorySec);
    return false;
  }
  killZombie(w, ai, cb, zid, attacker);
  void grid;
  return true;
}

/**
 * Zombie death: leaves the AI and movement (components `Zombie` and `MoveIntent` removed), stays
 * in the snapshot as a corpse (`anim = dead`), counts as a kill of `killer`.
 */
function killZombie(w: SimWorld, ai: AiWorld, cb: CombatWorld, zid: number, killer: number): void {
  const { Velocity, Position, StableId, Zombie } = w.c;
  Velocity.x[zid] = 0;
  Velocity.y[zid] = 0;
  Zombie.state[zid] = ZombieState.idle;
  Zombie.targetId[zid] = 0;
  detach(w, zid, w.c.Zombie);
  detach(w, zid, w.c.MoveIntent);
  ai.paths.delete(zid);
  const qi = ai.pathQueue.indexOf(zid);
  if (qi >= 0) ai.pathQueue.splice(qi, 1);
  ai.zombieCount--;
  cb.kills[killer] = (cb.kills[killer] ?? 0) + 1;
  cb.staggerUntil[zid] = 0;
  cb.zombieReady[zid] = 0;
  w.events.push({
    type: 'zombieKilled',
    tick: w.tick,
    zombie: StableId.value[zid] ?? 0,
    playerId: w.c.Player.id[killer] ?? 0,
    x: Position.x[zid] ?? 0,
    y: Position.y[zid] ?? 0,
  });
}

/** Chasing zombies in reach of their target attack after a wind-up, then every cooldown. */
function zombieAttacks(w: SimWorld, ai: AiWorld, cb: CombatWorld, grid: TileGrid): void {
  const { Position, Collider, Zombie, StableId, Facing } = w.c;
  const s = w.survival;
  const zc = cb.cfg.zombie;
  for (const zid of sortedQuery(w, 'zombies', [Zombie])) {
    const target = Zombie.state[zid] === ZombieState.chase ? (Zombie.targetId[zid] ?? 0) : 0;
    const pid = target ? playerBySid(w, target) : undefined;
    if (pid === undefined || s?.dead[pid] || w.tick < (cb.staggerUntil[zid] ?? 0)) {
      cb.zombieReady[zid] = 0;
      continue;
    }
    const z = Position.z[zid] ?? 0;
    const dx = (Position.x[pid] ?? 0) - (Position.x[zid] ?? 0);
    const dy = (Position.y[pid] ?? 0) - (Position.y[zid] ?? 0);
    const reach = zc.reachTiles + (Collider.radius[pid] ?? 0) + (Collider.radius[zid] ?? 0);
    const inReach =
      (Position.z[pid] ?? 0) === z &&
      dx * dx + dy * dy <= reach * reach &&
      lineOfSight(
        grid,
        z,
        Position.x[zid] ?? 0,
        Position.y[zid] ?? 0,
        Position.x[pid] ?? 0,
        Position.y[pid] ?? 0,
      );
    if (!inReach) {
      cb.zombieReady[zid] = 0;
      continue;
    }
    if (cb.zombieReady[zid] === 0) {
      cb.zombieReady[zid] = w.tick + secToTicks(zc.windupSec);
      continue;
    }
    if (w.tick < (cb.zombieReady[zid] ?? 0)) continue;
    const t = ai.types[Zombie.type[zid] ?? 0]!.def;
    cb.zombieReady[zid] = w.tick + secToTicks(t.attackCooldownSec);
    cb.swingTick[zid] = w.tick;
    if (dx !== 0 || dy !== 0) Facing.angle[zid] = atan2Bam(dy, dx);
    const rng = w.rng.combat;
    if (!rng.chance(zc.hitChance)) continue;
    const dmg = Math.fround(t.damage.min + rng.nextFloat() * (t.damage.max - t.damage.min));
    let killed = false;
    if (s) {
      const hp = clampStat((s.vitals.health[pid] ?? 0) - dmg);
      s.vitals.health[pid] = hp;
      if (hp <= 0) {
        s.cause[pid] = deathCauseIndex('zombie');
        killed = true;
      }
      const part = rng.int(0, BODY_PARTS.length - 1);
      const ww = cb.cfg.zombieWoundWeights;
      const kind = rng.chance(t.biteChance)
        ? 'bite'
        : rng.nextFloat() * (ww.scratch + ww.laceration) < ww.scratch
          ? 'scratch'
          : 'laceration';
      inflictWound(w, pid, part, woundKindIndex(kind), { zombie: true });
    }
    hitEvent(w, 'zombie', zid, pid, dmg, killed);
    void StableId;
  }
}

function playerBySid(w: SimWorld, sid: number): number | undefined {
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if (w.c.StableId.value[eid] === sid) return eid;
  }
  return undefined;
}
