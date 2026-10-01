import { DEFAULT_COMBAT_CONFIG, type CombatConfig } from './config.js';

/** `CombatWorld.reloadKind` values; names in `RELOAD_KINDS` (protocol `ReloadKind`). */
export const RK = { none: 0, magazine: 1, single: 2, unjam: 3, loadMagazine: 4 } as const;

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
  /** Zombie: tick of its next attack while in reach (0 = not in reach). */
  readonly zombieReady: Uint32Array;
  /** Player: zombies killed (`zombies-killed` counter for traits). */
  readonly kills: Uint32Array;
  /** Player: reload / magazine loading ends at this tick (0 = none), of item `reloadItem`. */
  readonly reloadUntil: Uint32Array;
  readonly reloadItem: Uint32Array;
  /** Player: tick the current reload step started (single-round loading: the current round). */
  readonly reloadStart: Uint32Array;
  /** Player: kind of the current reload (`ReloadKind`, 0 = none). */
  readonly reloadKind: Uint8Array;
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
    zombieReady: new Uint32Array(capacity),
    kills: new Uint32Array(capacity),
    reloadUntil: new Uint32Array(capacity),
    reloadItem: new Uint32Array(capacity),
    reloadStart: new Uint32Array(capacity),
    reloadKind: new Uint8Array(capacity),
    pending: [],
  };
}
