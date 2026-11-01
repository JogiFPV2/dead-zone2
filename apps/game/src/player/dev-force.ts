import type { PhysState } from '../anim/contract.js';

/**
 * Dev-only `?force=attack|knockback|reload&k=0..1` (anim v2): freeze the player view in an action
 * at progress `k` without driving the sim (frame strips for screenshots). Parsed only from the
 * dev query (`import.meta.env.DEV` in game.ts), so production builds never see it.
 */
export type DevForceKind = 'attack' | 'knockback' | 'reload';
export interface DevForce {
  kind: DevForceKind;
  /** Action progress 0..1. */
  k: number;
}

const KINDS: ReadonlySet<string> = new Set(['attack', 'knockback', 'reload']);

export function parseDevForce(q: URLSearchParams | undefined): DevForce | undefined {
  const kind = q?.get('force');
  if (!kind || !KINDS.has(kind)) return undefined;
  const k = Number(q?.get('k') ?? 0.5);
  return { kind: kind as DevForceKind, k: Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0.5 };
}

/** Knockback length shown by a forced stagger (ticks). */
export const FORCED_STAGGER_TICKS = 12;

/** Physics state with a stagger (hit from behind-left, full strength) at progress `k`. */
export function forcedKnockback(p: PhysState, tickF: number, k: number): PhysState {
  const start = Math.floor(tickF - k * FORCED_STAGGER_TICKS);
  return {
    ...p,
    state: 'stagger',
    stateStartTick: start,
    stateDuration: FORCED_STAGGER_TICKS,
    knockback: { dirX: -Math.cos(p.facing), dirY: -Math.sin(p.facing), strength: 1 },
    lastHitTick: start,
    hitFromDir: p.facing + Math.PI,
  };
}

/** Physics state held in a melee attack (the swing progress itself comes from `k`). */
export function forcedAttack(p: PhysState, tickF: number): PhysState {
  return { ...p, state: 'attack', stateStartTick: Math.floor(tickF) - 1, stateDuration: 60 };
}
