import { datan2 } from '../core/dmath.js';
import type { Rng } from '../core/rng.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';
import { canAct } from './modifiers.js';
import type { HitOutcome, PhysicsBody, PhysicsEvent, PhysicsHit, PhysicsState } from './types.js';

const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Angle in [0, 2π). */
export function normalizeAngle(a: number): number {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** Absolute difference of two angles in [0, π]. */
export function angleDistance(a: number, b: number): number {
  const d = normalizeAngle(a - b);
  return d > PI ? TWO_PI - d : d;
}

/** The attacker stands in the target's rear cone (facing + π ± `behindHalfArc`). */
export function isFromBehind(
  targetFacing: number,
  hitFromDir: number,
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): boolean {
  return angleDistance(targetFacing, hitFromDir) >= PI - cfg.behindHalfArc;
}

/**
 * Impulse 0..1 of a hit: weapon knockback × (strengthBase + strengthPerLevel × strength) ×
 * refMass / target mass. Heavier targets (big body, heavy backpack) are pushed less.
 */
export function hitImpulse(
  force: number,
  attackerStrength: number,
  targetMass: number,
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): number {
  const str = cfg.impulse.strengthBase + cfg.impulse.strengthPerLevel * attackerStrength;
  return Math.fround(clamp01((force * str * cfg.refMassKg) / Math.max(1, targetMass)));
}

/** Default weapon knockback of a hit kind. */
export function defaultForce(kind: PhysicsHit['kind'], cfg: PhysicsConfig): number {
  if (kind === 'shove') return cfg.impulse.shoveForce;
  if (kind === 'zombie') return cfg.impulse.zombieForce;
  return 0.3;
}

/**
 * Pure hit resolution. Always draws exactly 2 values from `rng` (reaction roll, knock-down
 * length), so the stream stays aligned whatever the outcome.
 */
export function resolveHit(
  attacker: PhysicsBody,
  target: PhysicsBody,
  hit: PhysicsHit,
  rng: Rng,
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): HitOutcome {
  const roll = rng.nextFloat();
  const kd =
    target.kind === 'zombie' ? cfg.durations.knockdownZombie : cfg.durations.knockdownPlayer;
  const kdTicks = rng.int(kd.min, kd.max);

  let dx = target.x - attacker.x;
  let dy = target.y - attacker.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 1e-6) {
    dx /= len;
    dy /= len;
  } else {
    dx = 1;
    dy = 0;
  }
  const hitFromDir = Math.fround(normalizeAngle(datan2(-dy, -dx)));
  const behind = isFromBehind(target.facing, hitFromDir, cfg);
  const impulse = hitImpulse(
    hit.force ?? defaultForce(hit.kind, cfg),
    attacker.strength,
    target.mass,
    cfg,
  );
  const shove = hit.kind === 'shove';
  const c = cfg.chance;

  let reaction: HitOutcome['reaction'] = 'hit';
  let duration = cfg.durations.hit;
  if (impulse >= cfg.impulse.minReaction) {
    const pKnock = clamp01(
      Math.max(0, impulse - c.knockdownMinImpulse) * c.knockdownPerImpulse +
        (behind
          ? hit.kind === 'zombie'
            ? c.behindZombieBonus
            : c.behindKnockdownBonus + (shove ? c.behindShoveBonus : 0)
          : 0),
    );
    const pStagger = clamp01(
      c.staggerBase + impulse * c.staggerPerImpulse + (shove ? c.shoveStaggerBonus : 0),
    );
    if (roll < pKnock) {
      reaction = 'knockdown';
      duration = kdTicks;
    } else if (roll < pKnock + (1 - pKnock) * pStagger) {
      reaction = 'stagger';
      duration = cfg.durations.staggerBase + Math.round(impulse * cfg.durations.staggerPerImpulse);
    }
  }
  return {
    reaction,
    impulse,
    behind,
    dirX: Math.fround(dx),
    dirY: Math.fround(dy),
    hitFromDir,
    duration,
  };
}

/** Switches state (no-op for the same open-ended state, so `stateStartTick` keeps its meaning). */
export function setState(b: PhysicsBody, state: PhysicsState, tick: number, duration = 0): void {
  if (b.state === state && duration === 0 && b.stateDuration === 0) return;
  b.state = state;
  b.stateStartTick = tick;
  b.stateDuration = duration;
}

const severity: Partial<Record<PhysicsState, number>> = { hit: 1, stagger: 2 };

/**
 * Applies a resolved hit to `target`: knock-back velocity, last hit, state and events. Dead
 * bodies ignore hits; a body on the ground (knockdown / getup) only records the hit (PZ: hitting
 * a lying zombie does not reset its fall).
 */
export function applyHit(
  target: PhysicsBody,
  out: HitOutcome,
  hit: PhysicsHit,
  tick: number,
  events: PhysicsEvent[],
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): void {
  if (target.state === 'dead') return;
  target.lastHitTick = tick;
  target.hitFromDir = out.hitFromDir;
  events.push({ type: 'hitLanded', entityId: target.id, tick, sourceId: hit.attackerId });
  if (hit.lethal) {
    pushBack(target, out, cfg);
    kill(target, tick, events);
    return;
  }
  if (target.state === 'knockdown' || target.state === 'getup' || target.state === 'fall') return;
  pushBack(target, out, cfg);
  if (out.reaction === 'knockdown') {
    setState(target, 'knockdown', tick, out.duration);
    events.push({ type: 'fellDown', entityId: target.id, tick });
  } else if (out.reaction === 'stagger') {
    setState(target, 'stagger', tick, out.duration);
    events.push({ type: 'staggered', entityId: target.id, tick });
  } else if ((severity[target.state] ?? 0) < 2) {
    setState(target, 'hit', tick, out.duration);
  }
}

function pushBack(b: PhysicsBody, out: HitOutcome, cfg: PhysicsConfig): void {
  b.knockback = { dirX: out.dirX, dirY: out.dirY, strength: out.impulse };
  const v = out.impulse * cfg.knockback.maxSpeed;
  b.vel = { x: Math.fround(out.dirX * v), y: Math.fround(out.dirY * v) };
}

/** Kills the body (state `dead`, event `died`). */
export function kill(b: PhysicsBody, tick: number, events: PhysicsEvent[]): void {
  if (b.state === 'dead') return;
  setState(b, 'dead', tick, 0);
  b.maxSpeed = 0;
  events.push({ type: 'died', entityId: b.id, tick });
}

/**
 * Starts an attack (`attack`) or a shove (`push`) of `b`; emits `attackStart`. Returns false when
 * the body cannot act (hit, stagger, knockdown, getup, dead). A running attack is restarted.
 */
export function startAttack(
  b: PhysicsBody,
  tick: number,
  events: PhysicsEvent[],
  shove = false,
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): boolean {
  if (!canAct(b.state)) return false;
  setState(b, shove ? 'push' : 'attack', tick, shove ? cfg.pushTicks : cfg.attackTicks);
  events.push({ type: 'attackStart', entityId: b.id, tick });
  return true;
}

/**
 * Ends timed states whose duration ran out at `tick`: knockdown → getup (own duration), getup →
 * idle (`gotUp`), hit / stagger / attack / push → idle.
 */
export function advanceState(
  b: PhysicsBody,
  tick: number,
  events: PhysicsEvent[],
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): void {
  if (b.stateDuration === 0 || tick - b.stateStartTick < b.stateDuration) return;
  const end = b.stateStartTick + b.stateDuration;
  switch (b.state) {
    case 'knockdown':
      setState(
        b,
        'getup',
        end,
        b.kind === 'zombie' ? cfg.durations.getupZombie : cfg.durations.getupPlayer,
      );
      b.vel = { x: 0, y: 0 };
      return;
    case 'getup':
      setState(b, 'idle', end);
      b.knockback = { dirX: 0, dirY: 0, strength: 0 };
      events.push({ type: 'gotUp', entityId: b.id, tick });
      return;
    case 'fall':
      // Landing (damage, knock-down) is done by the sim adapter (`stairs.ts` `landFalls`).
      return;
    case 'hit':
    case 'stagger':
      b.knockback = { dirX: 0, dirY: 0, strength: 0 };
      setState(b, 'idle', end);
      return;
    default:
      setState(b, 'idle', end);
  }
}
