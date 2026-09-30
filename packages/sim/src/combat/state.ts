import { DEFAULT_COMBAT_CONFIG, type CombatConfig } from './config.js';

/** Pending swing of a player this tick (from `attack` / `shove`, consumed by `combat`). */
export interface PendingAttack {
  eid: number;
  shove: boolean;
}

/**
 * Combat state per entity index (docs 2.5 `combat`). Ticks are absolute; 0 = none. Hashed
 * except `pending` (filled and emptied within one tick).
 */
export interface CombatWorld {
  readonly cfg: CombatConfig;
  /** Player: tick from which the next attack / shove is allowed. */
  readonly readyTick: Uint32Array;
  /** Player or zombie: tick of the last swing (snapshot `anim = attack`). */
  readonly swingTick: Uint32Array;
  /** Zombie: staggered (no movement, no attack) until this tick. */
  readonly staggerUntil: Uint32Array;
  /** Zombie: tick of its next attack while in reach (0 = not in reach). */
  readonly zombieReady: Uint32Array;
  /** Player: zombies killed (`zombies-killed` counter for traits). */
  readonly kills: Uint32Array;
  pending: PendingAttack[];
}

export function createCombatWorld(
  capacity: number,
  cfg: CombatConfig = DEFAULT_COMBAT_CONFIG,
): CombatWorld {
  return {
    cfg,
    readyTick: new Uint32Array(capacity),
    swingTick: new Uint32Array(capacity),
    staggerUntil: new Uint32Array(capacity),
    zombieReady: new Uint32Array(capacity),
    kills: new Uint32Array(capacity),
    pending: [],
  };
}
