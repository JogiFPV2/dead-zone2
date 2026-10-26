import {
  OPENING_ACTION_COMMANDS,
  OPENING_STATES,
  type Command,
  type CommandRejectReason,
  type OpeningActionType,
} from '@deadzone/protocol';
import { newAction, startAction } from '../actions/queue.js';
import { markChunk } from '../world/chunk-events.js';
import { emitNoise } from '../ai/noise.js';
import type { SimWorld } from '../core/world.js';
import type { TileGrid } from '../world/grid.js';
import {
  baseState,
  isCracked,
  isDoorLike,
  maxHp,
  openingKey,
  OpeningKind,
  openingView,
  OS,
  setOpening,
  sideIndex,
  topPlankHp,
  unpackKey,
} from './state.js';
import { floorZ } from '../world/levels.js';

type OpeningCommand = Extract<
  Command,
  {
    type:
      | 'toggleDoor'
      | 'breakWindow'
      | 'debugOpening'
      | 'coverWindow'
      | 'uncoverWindow'
      | OpeningActionType;
  }
>;

export const isOpeningCommand = (cmd: Command): cmd is OpeningCommand =>
  cmd.type === 'toggleDoor' ||
  cmd.type === 'breakWindow' ||
  cmd.type === 'debugOpening' ||
  cmd.type === 'coverWindow' ||
  cmd.type === 'uncoverWindow' ||
  (OPENING_ACTION_COMMANDS as readonly string[]).includes(cmd.type);

/** Centre of an edge: north edge (tx + 0.5, ty), west edge (tx, ty + 0.5). */
export const edgeCentre = (side: number, tx: number, ty: number): { x: number; y: number } =>
  side === 0 ? { x: tx + 0.5, y: ty } : { x: tx, y: ty + 0.5 };

export function emitOpeningChanged(
  w: SimWorld,
  key: number,
  kind: number,
  by: 'player' | 'zombie' | 'crowd' | 'debug' | 'vehicle',
): void {
  const view = openingView(w.openings, key, kind);
  w.events.push({ type: 'openingChanged', tick: w.tick, ...view, by });
  markChunk(w, view.tx, view.ty, view.z, 'opening');
}

/** `windowSmashed` + the loud `break` noise at the edge centre. */
export function windowSmashed(
  w: SimWorld,
  key: number,
  by: 'player' | 'zombie' | 'crowd' | 'vehicle',
  player?: { playerId: number; withHand: boolean },
  byEid?: number,
): void {
  const k = unpackKey(key);
  const c = edgeCentre(key % 2, k.tx, k.ty);
  const n = w.openings.cfg.breakNoise;
  const pn = byEid === undefined ? undefined : { eid: byEid, kind: 'window' as const };
  emitNoise(w, c.x, c.y, k.z, n.radiusTiles, n.volume, 'break', 0, pn);
  w.events.push({
    type: 'windowSmashed',
    tick: w.tick,
    tx: k.tx,
    ty: k.ty,
    z: k.z,
    side: k.side,
    by,
    ...player,
  });
}

/**
 * Damage to a blocking door / window / gate / fence (zombie blows, crowd pressure, a failed
 * `forceDoor`). Planks go first, one by one (the top plank's hp, the rest of a blow that knocks
 * it off is lost); then the edge: at 0 hp → `broken` (window: shatters; fence / gate: knocked
 * over, loud `break` noise). `openingChanged` carries hp / maxHp of the edge plus its planks.
 */
export function damageOpening(
  w: SimWorld,
  key: number,
  kind: number,
  dmg: number,
  by: 'player' | 'zombie' | 'crowd' | 'vehicle',
  byEid?: number,
): void {
  const o = w.openings;
  const e = o.states.get(key);
  const state = e?.state ?? baseState(o, key);
  const hp = e?.hp ?? maxHp(o.cfg, kind, state);
  if (e && e.planks > 0) {
    const ph = o.cfg.barricade.plankHp;
    const top = topPlankHp(o.cfg, e);
    if (dmg < top) setOpening(o, key, kind, state, hp, { bhp: e.bhp - dmg });
    else {
      const planks = e.planks - 1;
      setOpening(o, key, kind, state, hp, { planks, bhp: planks * ph });
    }
    emitOpeningChanged(w, key, kind, by);
    return;
  }
  if (state === OS.open || state === OS.broken) return;
  const left = hp - dmg;
  if (left > 0) {
    setOpening(o, key, kind, state, left);
    if (!isCracked(o, kind, state, hp) && isCracked(o, kind, state, left)) {
      const k = unpackKey(key);
      w.events.push({
        type: 'doorCracked',
        tick: w.tick,
        tx: k.tx,
        ty: k.ty,
        z: k.z,
        side: k.side,
        kind: kind === OpeningKind.gate ? 'gate' : 'door',
        by,
      });
    }
  } else {
    setOpening(o, key, kind, OS.broken, 0, { cleared: 0 });
    if (kind === OpeningKind.window) windowSmashed(w, key, by, undefined, byEid);
    else if (
      kind === OpeningKind.fence ||
      kind === OpeningKind.gate ||
      kind === OpeningKind.partition
    ) {
      const k = unpackKey(key);
      const c = edgeCentre(key % 2, k.tx, k.ty);
      const n = o.cfg.breakNoise;
      const pn = byEid === undefined ? undefined : { eid: byEid, kind: 'smash' as const };
      emitNoise(w, c.x, c.y, k.z, n.radiusTiles, n.volume, 'break', 0, pn);
    }
  }
  emitOpeningChanged(w, key, kind, by);
}

/** Edge (tx, ty, side) on level z: key, kind and current state. */
export function edgeAt(
  grid: TileGrid,
  w: SimWorld,
  side: number,
  tx: number,
  ty: number,
  z: number,
) {
  const id = side === 0 ? grid.edgeN(tx, ty, z) : grid.edgeW(tx, ty, z);
  const kind = grid.kindOf(id);
  const key = openingKey(side, tx, ty, z);
  const e = w.openings.states.get(key);
  return { key, kind, e, state: e?.state ?? baseState(w.openings, key), planks: e?.planks ?? 0 };
}

/** The player is within `reachTiles` of the edge centre. */
export function edgeInReach(w: SimWorld, eid: number, key: number): boolean {
  const k = unpackKey(key);
  const c = edgeCentre(key % 2, k.tx, k.ty);
  const dx = (w.c.Position.x[eid] ?? 0) - c.x;
  const dy = (w.c.Position.y[eid] ?? 0) - c.y;
  const r = w.openings.cfg.reachTiles;
  return k.z === floorZ(w, eid) && dx * dx + dy * dy <= r * r;
}

/**
 * `toggleDoor` / `debugOpening` (docs 2.5 `openings`); `breakWindow` and the timed edge
 * commands (`smashWindow`, `climbThrough`, `removeGlass`, `barricade`, `removeBarricade`,
 * `forceDoor`) start timed actions (`openings/timed.ts`).
 */
export function applyOpeningCommand(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  cmd: OpeningCommand,
): CommandRejectReason | undefined {
  const o = w.openings;
  const side = sideIndex(cmd.side);
  const z = cmd.type === 'debugOpening' ? (cmd.z ?? 0) : floorZ(w, eid);
  const { key, kind, e: prev, state, planks } = edgeAt(grid, w, side, cmd.tx, cmd.ty, z);
  if (cmd.type === 'debugOpening') {
    if (!w.dev) return 'dev-only';
    if (kind === OpeningKind.wall) return 'invalid-target';
    let next = OPENING_STATES.indexOf(cmd.state);
    if (next === OS.locked && !isDoorLike(kind)) return 'invalid-state';
    if (kind === OpeningKind.fence && next !== OS.closed && next !== OS.broken)
      return 'invalid-state';
    // `barricaded` = closed with every plank (planks are a count since the barricade PR).
    const full = next === OS.barricaded;
    if (full) next = OS.closed;
    const n = full ? o.cfg.barricade.maxPlanks : 0;
    setOpening(o, key, kind, next, undefined, {
      planks: n,
      bhp: n * o.cfg.barricade.plankHp,
      cleared: 0,
    });
    emitOpeningChanged(w, key, kind, 'debug');
    return undefined;
  }
  if (cmd.type === 'coverWindow')
    return startAction(w, eid, newAction('coverWindow', { edge: key, item: cmd.item }));
  if (cmd.type !== 'toggleDoor') {
    const action = cmd.type === 'breakWindow' ? 'smashWindow' : cmd.type;
    return startAction(w, eid, newAction(action, { edge: key }));
  }
  if (kind === OpeningKind.wall || kind === OpeningKind.fence || kind === OpeningKind.partition)
    return 'invalid-target';
  if (!edgeInReach(w, eid, key)) return 'out-of-range';
  if (w.survival?.asleep[eid]) return 'invalid-state';
  if (state === OS.barricaded || state === OS.broken || planks > 0) return 'invalid-state';
  let next: number;
  if (cmd.lock) {
    if (!isDoorLike(kind) || state === OS.open) return 'invalid-state';
    next = state === OS.locked ? OS.closed : OS.locked;
  } else {
    if (state === OS.locked) return 'locked';
    next = state === OS.open ? OS.closed : OS.open;
  }
  const c = edgeCentre(side, cmd.tx, cmd.ty);
  const n = o.cfg.toggleNoise;
  emitNoise(w, c.x, c.y, z, n.radiusTiles, n.volume, 'action', 0, { eid, kind: 'door' });
  // A damaged door / window keeps its damage when opened, closed or locked.
  setOpening(o, key, kind, next, prev && prev.hp > 0 ? prev.hp : undefined);
  emitOpeningChanged(w, key, kind, 'player');
  return undefined;
}
