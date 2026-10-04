import type { EdgeSide, OpeningState } from '@deadzone/protocol';

/**
 * Door targeting for the interact key (F tap): which door edge, if any, the player acts on.
 * Pure (tests); the game feeds it the door edges of `OpeningsView` and their states.
 */

/** Doors whose edge centre is within this many tiles count as in reach (sim reach: 1.5). */
export const DOOR_REACH_TILES = 1.4;
/** A door this close (tiles from its centre) wins over a container in reach. */
export const DOOR_FIRST_TILES = 0.9;

export interface DoorEdge {
  tx: number;
  ty: number;
  z: number;
  side: EdgeSide;
}

export interface DoorTarget extends DoorEdge {
  /** Distance (tiles) from the player to the edge centre. */
  dist: number;
  state: OpeningState;
}

/** Centre of a door edge in sim tiles: north edge (tx + 0.5, ty), west edge (tx, ty + 0.5). */
export const doorCentre = (e: DoorEdge): { x: number; y: number } =>
  e.side === 'n' ? { x: e.tx + 0.5, y: e.ty } : { x: e.tx, y: e.ty + 0.5 };

/**
 * Nearest door on the player's level within `DOOR_REACH_TILES`. Broken doors (smashed leaf)
 * cannot be toggled and are skipped; locked ones are kept (the sim answers `locked`).
 */
export function nearestDoor(
  edges: readonly DoorEdge[],
  stateOf: (e: DoorEdge) => OpeningState,
  x: number,
  y: number,
  z: number,
): DoorTarget | undefined {
  let best: DoorTarget | undefined;
  for (const e of edges) {
    if (e.z !== z) continue;
    const c = doorCentre(e);
    const dist = Math.hypot(c.x - x, c.y - y);
    if (dist > DOOR_REACH_TILES || (best && dist >= best.dist)) continue;
    const state = stateOf(e);
    if (state === 'broken') continue;
    best = { tx: e.tx, ty: e.ty, z: e.z, side: e.side, dist, state };
  }
  return best;
}

/** F tap: the door is used instead of the container when nothing else is in reach or it is very close. */
export const doorWins = (door: DoorTarget | undefined, hasContainer: boolean): boolean =>
  door !== undefined && (!hasContainer || door.dist < DOOR_FIRST_TILES);

/** Prompt verb for a door (`[F] Otwórz` / `[F] Zamknij`; a locked door reads `Zamknięte`). */
export function doorVerb(state: OpeningState): string {
  if (state === 'open') return 'Zamknij';
  if (state === 'locked') return 'Zamknięte';
  return 'Otwórz';
}

/** Toast for a `toggleDoor` rejected with `locked`. */
export const LOCKED_TOAST = 'Zamknięte';

/** Toast text for a sim event when it is the local player's `toggleDoor` hitting a locked door. */
export function lockedDoorToast(
  e: { type: string; playerId?: number; reason?: string },
  playerId: number,
): string | undefined {
  return e.type === 'commandRejected' && e.playerId === playerId && e.reason === 'locked'
    ? LOCKED_TOAST
    : undefined;
}
