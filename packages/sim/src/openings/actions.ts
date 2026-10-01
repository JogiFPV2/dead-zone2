import { OPENING_STATES, type Command, type CommandRejectReason } from '@deadzone/protocol';
import { emitNoise } from '../ai/noise.js';
import type { SimWorld } from '../core/world.js';
import type { TileGrid } from '../world/grid.js';
import {
  maxHp,
  openingKey,
  OpeningKind,
  openingView,
  OS,
  setOpening,
  sideIndex,
  unpackKey,
} from './state.js';

type OpeningCommand = Extract<Command, { type: 'toggleDoor' | 'breakWindow' | 'debugOpening' }>;

export const isOpeningCommand = (cmd: Command): cmd is OpeningCommand =>
  cmd.type === 'toggleDoor' || cmd.type === 'breakWindow' || cmd.type === 'debugOpening';

/** Centre of an edge: north edge (tx + 0.5, ty), west edge (tx, ty + 0.5). */
export const edgeCentre = (side: number, tx: number, ty: number): { x: number; y: number } =>
  side === 0 ? { x: tx + 0.5, y: ty } : { x: tx, y: ty + 0.5 };

export function emitOpeningChanged(
  w: SimWorld,
  key: number,
  kind: number,
  by: 'player' | 'zombie' | 'crowd' | 'debug',
): void {
  w.events.push({
    type: 'openingChanged',
    tick: w.tick,
    ...openingView(w.openings, key, kind),
    by,
  });
}

/**
 * Damage to a closed / locked / barricaded door, window or fence (zombie blows, crowd pressure).
 * Planks go first (door → `closed` with full hp, window → `broken`); at 0 hp → `broken` (a fence:
 * knocked over).
 */
export function damageOpening(
  w: SimWorld,
  key: number,
  kind: number,
  dmg: number,
  by: 'player' | 'zombie' | 'crowd',
): void {
  const o = w.openings;
  const e = o.states.get(key);
  const state = e?.state ?? OS.closed;
  if (state === OS.open || state === OS.broken) return;
  const hp = (e?.hp ?? maxHp(o.cfg, kind, state)) - dmg;
  if (hp > 0) setOpening(o, key, kind, state, hp);
  else if (state === OS.barricaded && kind === OpeningKind.door)
    setOpening(o, key, kind, OS.closed);
  else {
    setOpening(o, key, kind, OS.broken);
    if (kind === OpeningKind.window || kind === OpeningKind.fence) {
      const k = unpackKey(key);
      const c = edgeCentre(key % 2, k.tx, k.ty);
      const n = o.cfg.breakNoise;
      emitNoise(w, c.x, c.y, k.z, n.radiusTiles, n.volume, 'break');
    }
  }
  emitOpeningChanged(w, key, kind, by);
}

/** `toggleDoor` / `breakWindow` / `debugOpening` (docs 2.5 `openings`). */
export function applyOpeningCommand(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  cmd: OpeningCommand,
): CommandRejectReason | undefined {
  const o = w.openings;
  const side = sideIndex(cmd.side);
  const z = cmd.type === 'debugOpening' ? (cmd.z ?? 0) : (w.c.Position.z[eid] ?? 0);
  const id = side === 0 ? grid.edgeN(cmd.tx, cmd.ty, z) : grid.edgeW(cmd.tx, cmd.ty, z);
  const kind = grid.kindOf(id);
  if (cmd.type === 'debugOpening') {
    if (!w.dev) return 'dev-only';
    if (kind === OpeningKind.wall) return 'invalid-target';
    const state = OPENING_STATES.indexOf(cmd.state);
    if (state === OS.locked && kind === OpeningKind.window) return 'invalid-state';
    if (kind === OpeningKind.fence && state !== OS.closed && state !== OS.broken)
      return 'invalid-state';
    const key = openingKey(side, cmd.tx, cmd.ty, z);
    setOpening(o, key, kind, state);
    emitOpeningChanged(w, key, kind, 'debug');
    return undefined;
  }
  if (kind === OpeningKind.wall || kind === OpeningKind.fence) return 'invalid-target';
  const c = edgeCentre(side, cmd.tx, cmd.ty);
  const dx = (w.c.Position.x[eid] ?? 0) - c.x;
  const dy = (w.c.Position.y[eid] ?? 0) - c.y;
  if (dx * dx + dy * dy > o.cfg.reachTiles * o.cfg.reachTiles) return 'out-of-range';
  if (w.survival?.asleep[eid]) return 'invalid-state';
  const key = openingKey(side, cmd.tx, cmd.ty, z);
  const prev = o.states.get(key);
  const state = prev?.state ?? OS.closed;
  let next: number;
  if (cmd.type === 'breakWindow') {
    if (kind !== OpeningKind.window) return 'invalid-target';
    if (state !== OS.closed && state !== OS.open) return 'invalid-state';
    next = OS.broken;
    const n = o.cfg.breakNoise;
    emitNoise(w, c.x, c.y, z, n.radiusTiles, n.volume, 'break');
  } else {
    if (state === OS.barricaded || state === OS.broken) return 'invalid-state';
    if (cmd.lock) {
      if (kind !== OpeningKind.door || state === OS.open) return 'invalid-state';
      next = state === OS.locked ? OS.closed : OS.locked;
    } else {
      if (state === OS.locked) return 'locked';
      next = state === OS.open ? OS.closed : OS.open;
    }
    const n = o.cfg.toggleNoise;
    emitNoise(w, c.x, c.y, z, n.radiusTiles, n.volume, 'action');
  }
  // A damaged door / window keeps its damage when opened, closed or locked.
  const keep = next !== OS.broken && prev && prev.hp > 0;
  setOpening(o, key, kind, next, keep ? prev.hp : undefined);
  emitOpeningChanged(w, key, kind, 'player');
  return undefined;
}
