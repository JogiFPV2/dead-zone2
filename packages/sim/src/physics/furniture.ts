import {
  CHUNK_SIZE,
  type CommandRejectReason,
  type PlayerId,
  type SimEvent,
} from '@deadzone/protocol';
import { emitNoise } from '../ai/noise.js';
import { gridOf } from '../ai/commands.js';
import { newAction, registerAction, startAction } from '../actions/queue.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { objectFurnitureId, unpackObjectId } from '../furniture/menu.js';
import { storageTypesOf } from '../items/loot.js';
import { containerWeight, tileKey, type ActionState, type ItemContainer } from '../items/store.js';
import { invalidateNavArea } from '../nav/grid-nav.js';
import { skillLevel } from '../progress/skills.js';
import { clampStat } from '../survival/state.js';
import { Pen, penaltyMul } from '../survival/penalties.js';
import { obbOf, obbVsObb } from '../vehicles/geometry.js';
import { vehicleTypes } from '../vehicles/seats.js';
import { markChunk } from '../world/chunk-events.js';
import { circleOverlaps } from '../world/collision.js';
import { rectDist2, type TileRect } from '../world/furniture.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ } from '../world/levels.js';
import { enduranceLevel, loadLevel } from './modifiers.js';
import { baseMapOf, objectOrigin, parseOrigin } from './furniture-overlay.js';
import type { FurnitureMove } from './types.js';

/**
 * Pushing / pulling furniture one tile and rotating it 90° (docs 9.61). Mechanics only; the
 * menu / UI hooks call `sim.pushFurniture` / `pullFurniture` / `rotateFurniture` (timed action
 * `moveFurniture`) and `sim.canMoveFurniture`. A move is checked on every occupied tile after
 * the move (floor, no stairs, no other furniture, bodies, corpses, cars; no wall / closed
 * opening crossed; the piece never straddles an edge), weight against the character's strength.
 * The new placement goes to `physics.furnitureMoves` (saved, hashed) and overrides the map
 * through `furnitureOverlay`; world storage and tank state move with the piece.
 */

export type FurnitureMoveMode = 'push' | 'pull' | 'rotate';
const MODES: readonly FurnitureMoveMode[] = ['push', 'pull', 'rotate'];

/** Result of `canMoveFurniture` (and of the check at the start / end of the action). */
export interface FurnitureMoveCheck {
  ok: boolean;
  reason?: CommandRejectReason;
  /** Weight of the piece incl. contents (kg). */
  weightKg: number;
  /** What the character can move this way (kg). */
  strengthKg: number;
  /** Duration of the action in ticks (20 Hz). */
  ticks: number;
  /** Move direction (push / pull; 0, 0 for a rotation). */
  dx: number;
  dy: number;
}

/** A map object resolved from a furniture id (`objectFurnitureId`). */
interface Piece {
  origin: string;
  contentId: string;
  x: number;
  y: number;
  z: number;
  /** Index among the objects on its anchor tile (the `n` of the id). */
  n: number;
  rot: number;
  rect: TileRect;
  tall: boolean;
}

/** Grids whose nav step masks cache furniture (the sim's step grid; `gridOf` is added). */
const navGrids = new WeakMap<SimWorld, Set<TileGrid>>();
export function registerFurnitureGrid(w: SimWorld, grid: TileGrid): void {
  let s = navGrids.get(w);
  if (!s) navGrids.set(w, (s = new Set()));
  s.add(grid);
}

/** Objects on world tile (x, y, z) in chunk order: index in the chunk and the object. */
function onTile(w: SimWorld, x: number, y: number, z: number) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const chunk = w.map.getChunk(cx, cy, z);
  const out: { origin: string; contentId: string; rot: number }[] = [];
  (chunk?.objects ?? []).forEach((o, i) => {
    if (cx * CHUNK_SIZE + o.x !== x || cy * CHUNK_SIZE + o.y !== y) return;
    out.push({
      origin: objectOrigin(chunk!, cx, cy, z, i),
      contentId: o.contentId,
      rot: o.rot ?? 0,
    });
  });
  return out;
}

function pieceAt(w: SimWorld, x: number, y: number, z: number, n: number): Piece | undefined {
  const f = w.furniture;
  const o = onTile(w, x, y, z)[n];
  const d = o && f?.resolve(o.contentId);
  if (!o || !d || !f) return undefined;
  const s = f.sizeOf(o.contentId, o.rot);
  return {
    origin: o.origin,
    contentId: o.contentId,
    x,
    y,
    z,
    n,
    rot: o.rot & 3,
    rect: { x, y, w: s.w, h: s.h },
    tall: d.tall,
  };
}

/** The furniture piece of a `useFurniture` id (undefined: no such movable piece). */
export function furniturePiece(w: SimWorld, furnitureId: number): Piece | undefined {
  if (!Number.isSafeInteger(furnitureId) || furnitureId < 2 ** 42) return undefined;
  const p = unpackObjectId(furnitureId);
  return pieceAt(w, p.x, p.y, p.z, p.n);
}

/** Current piece of origin `key` (after earlier moves). */
function pieceByOrigin(w: SimWorld, key: string): Piece | undefined {
  const m = w.physics.furnitureMoves.get(key);
  let x: number;
  let y: number;
  let z: number;
  if (m) ({ x, y, z } = m);
  else {
    const o = parseOrigin(key);
    const obj = baseMapOf(w.map).getChunk(o.cx, o.cy, o.z)?.objects?.[o.i];
    if (!obj) return undefined;
    x = o.cx * CHUNK_SIZE + obj.x;
    y = o.cy * CHUNK_SIZE + obj.y;
    z = o.z;
  }
  const n = onTile(w, x, y, z).findIndex((t) => t.origin === key);
  return n < 0 ? undefined : pieceAt(w, x, y, z, n);
}

/** World storage of the piece: per storage type the first unclaimed container on its tile. */
function piecesStorage(w: SimWorld, p: Piece): ItemContainer[] {
  const st = w.items;
  if (!st) return [];
  const ids = st.worldByTile.get(tileKey(p.x, p.y, p.z)) ?? [];
  const claimed = new Set<number>();
  let mine: ItemContainer[] = [];
  const objs = onTile(w, p.x, p.y, p.z);
  for (let k = 0; k <= p.n && k < objs.length; k++) {
    const got: ItemContainer[] = [];
    for (const type of storageTypesOf(st, objs[k]!.contentId)) {
      const id = ids.find((i) => !claimed.has(i) && st.containers.get(i)?.type === type);
      if (id === undefined) continue;
      claimed.add(id);
      got.push(st.containers.get(id)!);
    }
    if (k === p.n) mine = got;
  }
  return mine;
}

/** Weight in kg: content `weightKg` of a placeable, else tiles × kg per tile; plus contents. */
export function furnitureWeightKg(w: SimWorld, p: Piece): number {
  const cfg = w.physics.cfg.furniture;
  const content = w.survival?.content;
  const item = content?.items[content.itemIndex.get(p.contentId) ?? -1];
  let kg =
    item?.kind === 'placeable'
      ? item.weightKg
      : p.rect.w * p.rect.h * (p.tall ? cfg.kgPerTileTall : cfg.kgPerTile);
  if (cfg.countContents && w.items)
    for (const c of piecesStorage(w, p)) kg += containerWeight(w.items, c.id);
  return Math.fround(kg);
}

/** What player `eid` can push (pull, rotate) in kg (strength, fatigue, wounds, load, endurance). */
export function furnitureStrengthKg(w: SimWorld, eid: number, mode: FurnitureMoveMode): number {
  const cfg = w.physics.cfg.furniture;
  const b = w.physics.bodies.get(w.c.StableId.value[eid] ?? 0);
  const fatigue = w.survival?.vitals.fatigue[eid] ?? 0;
  const ll = b ? loadLevel(b.carriedKg, b.capacityKg) : 0;
  const el = b ? enduranceLevel(b.endurance) : 0;
  const kg =
    cfg.basePushKg *
    (1 + cfg.perStrengthLevel * skillLevel(w, eid, 'base:strength')) *
    Math.max(0, 1 - (cfg.fatigueWeight * fatigue) / 100) *
    penaltyMul(w, eid, Pen.action) *
    (cfg.loadMul[ll] ?? 1) *
    (cfg.enduranceMul[el] ?? 1) *
    (mode === 'pull' ? cfg.pullMul : mode === 'rotate' ? cfg.rotateMul : 1);
  return Math.fround(kg);
}

/** Cardinal direction from the piece towards the player (the side the player stands on). */
function sideOf(r: TileRect, px: number, py: number): { dx: number; dy: number } {
  const ox = px < r.x ? px - r.x : px > r.x + r.w ? px - (r.x + r.w) : 0;
  const oy = py < r.y ? py - r.y : py > r.y + r.h ? py - (r.y + r.h) : 0;
  if (ox === 0 && oy === 0) return { dx: 0, dy: 0 };
  return Math.abs(ox) >= Math.abs(oy) ? { dx: Math.sign(ox), dy: 0 } : { dx: 0, dy: Math.sign(oy) };
}

const inRect = (r: TileRect, tx: number, ty: number): boolean =>
  tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;

/** Blocking edge between tile (tx, ty) and its neighbour (tx + dx, ty + dy). */
function wallBetween(g: TileGrid, tx: number, ty: number, z: number, dx: number, dy: number) {
  if (dx > 0) return g.hasWallW(tx + 1, ty, z);
  if (dx < 0) return g.hasWallW(tx, ty, z);
  if (dy > 0) return g.hasWallN(tx, ty + 1, z);
  return g.hasWallN(tx, ty, z);
}

/**
 * Can `p` stand on `to` (moved by dx, dy from `p.rect`, or rotated in place when both are 0)?
 * `ignore` = entity allowed on the new tiles (the puller, who steps back).
 */
function placementBlocked(
  w: SimWorld,
  g: TileGrid,
  p: Piece,
  to: TileRect,
  dx: number,
  dy: number,
  ignore: number,
): boolean {
  const z = p.z;
  for (let ty = to.y; ty < to.y + to.h; ty++) {
    for (let tx = to.x; tx < to.x + to.w; tx++) {
      if (g.isVoid(tx, ty, z) || g.stairAt(tx, ty, z)) return true;
      if (!inRect(p.rect, tx, ty) && g.furnitureBlocks(tx, ty, z)) return true;
      // Never straddles a wall, a doorway or a window frame.
      if (tx > to.x && g.edgeW(tx, ty, z) !== 0) return true;
      if (ty > to.y && g.edgeN(tx, ty, z) !== 0) return true;
    }
  }
  if (dx || dy) {
    for (let ty = p.rect.y; ty < p.rect.y + p.rect.h; ty++)
      for (let tx = p.rect.x; tx < p.rect.x + p.rect.w; tx++)
        if (wallBetween(g, tx, ty, z, dx, dy)) return true;
  }
  // Bodies: anything with a collider on this level whose circle reaches a new tile.
  const { Position, Collider } = w.c;
  for (const eid of sortedQuery(w, 'colliders', [Position, Collider])) {
    if (eid === ignore || floorZ(w, eid) !== z) continue;
    const x = Position.x[eid] ?? 0;
    const y = Position.y[eid] ?? 0;
    const r = Collider.radius[eid] ?? 0;
    const cx = Math.min(Math.max(x, to.x), to.x + to.w);
    const cy = Math.min(Math.max(y, to.y), to.y + to.h);
    if ((cx - x) * (cx - x) + (cy - y) * (cy - y) < r * r) return true;
  }
  // Corpses (lootable bodies) lying on a new tile.
  const st = w.items;
  if (st)
    for (const id of st.corpses.values()) {
      const c = st.containers.get(id);
      if (c && c.z === z && inRect(to, Math.floor(c.x), Math.floor(c.y))) return true;
    }
  const box = { x: to.x + to.w / 2, y: to.y + to.h / 2, hx: 1, hy: 0, hl: to.w / 2, hw: to.h / 2 };
  for (const v of w.physics.vehicles.values()) {
    const t = vehicleTypes(w)[v.type];
    if (t && Math.floor(v.z) === z && obbVsObb(box, obbOf(v, t))) return true;
  }
  return false;
}

function rotated(w: SimWorld, p: Piece): { rect: TileRect; rot: number } {
  const rot = (p.rot + 1) & 3;
  const s = w.furniture!.sizeOf(p.contentId, rot);
  return { rect: { x: p.x, y: p.y, w: s.w, h: s.h }, rot };
}

/**
 * Checks a move of `p` by player `eid` (direction from the player's side for push / pull).
 * Pure: no state changes.
 */
export function checkFurnitureMove(
  w: SimWorld,
  eid: number,
  p: Piece | undefined,
  mode: FurnitureMoveMode,
  dir?: { dx: number; dy: number },
): FurnitureMoveCheck {
  const cfg = w.physics.cfg.furniture;
  const fail = (reason: CommandRejectReason, extra: Partial<FurnitureMoveCheck> = {}) => ({
    ok: false,
    reason,
    weightKg: 0,
    strengthKg: 0,
    ticks: 0,
    dx: 0,
    dy: 0,
    ...extra,
  });
  if (!cfg.enabled || !w.furniture) return fail('invalid-state');
  if (!p) return fail('invalid-target');
  if (w.survival?.dead[eid] || w.survival?.asleep[eid]) return fail('invalid-state');
  const b = w.physics.bodies.get(w.c.StableId.value[eid] ?? 0);
  if (b?.vehicle) return fail('invalid-state');
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  if (floorZ(w, eid) !== p.z || rectDist2(p.rect, px, py) > cfg.reachTiles * cfg.reachTiles)
    return fail('out-of-range');
  const weightKg = furnitureWeightKg(w, p);
  const strengthKg = furnitureStrengthKg(w, eid, mode);
  const load = weightKg / Math.max(1e-6, strengthKg);
  const base = mode === 'rotate' ? cfg.rotateTicks : cfg.moveTicks;
  const ticks = Math.max(1, Math.round(base * (1 + cfg.slowPerLoad * Math.min(1, load))));
  const side = dir ?? sideOf(p.rect, px, py);
  const dx = mode === 'rotate' ? 0 : (mode === 'push' ? -side.dx : side.dx) || 0;
  const dy = mode === 'rotate' ? 0 : (mode === 'push' ? -side.dy : side.dy) || 0;
  const info = { weightKg, strengthKg, ticks, dx, dy };
  if (weightKg > strengthKg) return fail('too-heavy', info);
  if (mode !== 'rotate' && !dx && !dy) return fail('invalid-state', info);
  const g = gridOf(w);
  const to =
    mode === 'rotate' ? rotated(w, p).rect : { ...p.rect, x: p.rect.x + dx, y: p.rect.y + dy };
  if (placementBlocked(w, g, p, to, dx, dy, mode === 'pull' ? eid : -1))
    return fail('blocked', info);
  if (mode === 'pull') {
    // The puller steps back one tile with the piece.
    const r = w.c.Collider.radius[eid] ?? 0.3;
    const tx = Math.floor(px);
    const ty = Math.floor(py);
    if (wallBetween(g, tx, ty, p.z, dx, dy) || circleOverlaps(g, p.z, px + dx, py + dy, r))
      return fail('blocked', info);
    const { Position, Collider } = w.c;
    for (const o of sortedQuery(w, 'colliders', [Position, Collider])) {
      if (o === eid || floorZ(w, o) !== p.z) continue;
      const ox = (Position.x[o] ?? 0) - (px + dx);
      const oy = (Position.y[o] ?? 0) - (py + dy);
      const rr = r + (Collider.radius[o] ?? 0);
      if (ox * ox + oy * oy < rr * rr) return fail('blocked', info);
    }
  }
  return { ok: true, ...info };
}

/** Moves `p` to `to` / `rot`: state, storage, tanks, caches, events. */
function applyMove(
  w: SimWorld,
  p: Piece,
  to: TileRect,
  rot: number,
  cause: 'push' | 'pull' | 'rotate' | 'crowd',
  playerId: PlayerId | undefined,
): void {
  const pw = w.physics;
  const st = w.items;
  const fromId = objectFurnitureId(p.x, p.y, p.z, p.n);
  const storage = piecesStorage(w, p);
  // Tank state by origin on the old and the new anchor tile (indices on a tile may shift).
  const tankKeys = (x: number, y: number) =>
    onTile(w, x, y, p.z).map((o, n) => ({ origin: o.origin, key: `${x},${y},${p.z},${n}` }));
  const before = [...tankKeys(p.x, p.y), ...tankKeys(to.x, to.y)];
  const litres = new Map<string, number>();
  for (const t of before) {
    const l = st?.waterTanks?.get(t.key);
    if (l !== undefined) {
      litres.set(t.origin, l);
      st!.waterTanks!.delete(t.key);
    }
  }
  const o = parseOrigin(p.origin);
  const baseObj = baseMapOf(w.map).getChunk(o.cx, o.cy, o.z)?.objects?.[o.i];
  const home =
    baseObj &&
    o.cx * CHUNK_SIZE + baseObj.x === to.x &&
    o.cy * CHUNK_SIZE + baseObj.y === to.y &&
    ((baseObj.rot ?? 0) & 3) === rot;
  if (home) pw.furnitureMoves.delete(p.origin);
  else {
    const m: FurnitureMove = { contentId: p.contentId, x: to.x, y: to.y, z: p.z, rot };
    pw.furnitureMoves.set(p.origin, m);
  }
  pw.furnitureRev++;
  for (const t of [...tankKeys(p.x, p.y), ...tankKeys(to.x, to.y)]) {
    const l = litres.get(t.origin);
    if (l !== undefined) (st!.waterTanks ??= new Map()).set(t.key, l);
  }
  if (st && storage.length) {
    const oldKey = tileKey(p.x, p.y, p.z);
    const newKey = tileKey(to.x, to.y, p.z);
    const ids = new Set(storage.map((c) => c.id));
    const left = (st.worldByTile.get(oldKey) ?? []).filter((i) => !ids.has(i));
    if (left.length) st.worldByTile.set(oldKey, left);
    else st.worldByTile.delete(oldKey);
    st.worldByTile.set(newKey, [...(st.worldByTile.get(newKey) ?? []), ...ids]);
    for (const c of storage) {
      (c as { x: number }).x = to.x;
      (c as { y: number }).y = to.y;
    }
    st.version++;
  }
  // Caches: footprint masks of both chunks, nav step masks of the area.
  const f = w.furniture!;
  f.invalidate(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.y / CHUNK_SIZE), p.z);
  f.invalidate(Math.floor(to.x / CHUNK_SIZE), Math.floor(to.y / CHUNK_SIZE), p.z);
  const x0 = Math.min(p.rect.x, to.x);
  const y0 = Math.min(p.rect.y, to.y);
  const x1 = Math.max(p.rect.x + p.rect.w, to.x + to.w) - 1;
  const y1 = Math.max(p.rect.y + p.rect.h, to.y + to.h) - 1;
  const grids = navGrids.get(w) ?? new Set<TileGrid>();
  grids.add(gridOf(w));
  for (const g of grids) invalidateNavArea(g, p.z, x0, y0, x1, y1);
  const n = onTile(w, to.x, to.y, p.z).findIndex((t) => t.origin === p.origin);
  const ev: Extract<SimEvent, { type: 'furnitureMoved' }> = {
    type: 'furnitureMoved',
    tick: w.tick,
    cause,
    ...(playerId !== undefined ? { playerId } : {}),
    contentId: p.contentId,
    fromId,
    toId: objectFurnitureId(to.x, to.y, p.z, Math.max(0, n)),
    fromX: p.x,
    fromY: p.y,
    x: to.x,
    y: to.y,
    z: p.z,
    rot,
    w: to.w,
    h: to.h,
  };
  w.events.push(ev);
  markChunk(w, p.x, p.y, p.z, 'object');
  if (
    Math.floor(to.x / CHUNK_SIZE) !== Math.floor(p.x / CHUNK_SIZE) ||
    Math.floor(to.y / CHUNK_SIZE) !== Math.floor(p.y / CHUNK_SIZE)
  )
    markChunk(w, to.x, to.y, p.z, 'object');
}

// ── Timed action ─────────────────────────────────────────────────────────────────────────

/** `ActionState.furniture`: the piece (origin key), the mode and the direction fixed at start. */
const stateOf = (a: ActionState) => a.furniture;

function check(w: SimWorld, eid: number, a: ActionState): FurnitureMoveCheck {
  const s = stateOf(a);
  if (!s) return checkFurnitureMove(w, eid, undefined, 'push');
  const mode = MODES[s.mode] ?? 'push';
  return checkFurnitureMove(w, eid, pieceByOrigin(w, s.origin), mode, s.dir);
}

export function registerFurnitureMoveActions(): void {
  registerAction('moveFurniture', {
    validate: (w, eid, a) => check(w, eid, a).reason,
    durationMin: () => 0,
    ticks: (w, eid, a) => check(w, eid, a).ticks,
    complete(w, eid, a) {
      const s = stateOf(a);
      const p = s && pieceByOrigin(w, s.origin);
      const c = check(w, eid, a);
      if (!s || !p || !c.ok) return;
      const mode = MODES[s.mode] ?? 'push';
      const cfg = w.physics.cfg.furniture;
      let to = { ...p.rect, x: p.rect.x + c.dx, y: p.rect.y + c.dy };
      let rot = p.rot;
      if (mode === 'rotate') ({ rect: to, rot } = rotated(w, p));
      applyMove(w, p, to, rot, mode, w.c.Player.id[eid] ?? 0);
      if (mode === 'pull') {
        w.c.Position.x[eid] = Math.fround((w.c.Position.x[eid] ?? 0) + c.dx);
        w.c.Position.y[eid] = Math.fround((w.c.Position.y[eid] ?? 0) + c.dy);
      }
      const v = w.survival?.vitals;
      if (v) {
        v.endurance[eid] = clampStat(
          (v.endurance[eid] ?? 100) - (cfg.enduranceBase + cfg.endurancePerKg * c.weightKg),
        );
        v.fatigue[eid] = clampStat((v.fatigue[eid] ?? 0) + cfg.fatiguePerKg * c.weightKg);
      }
      emitNoise(
        w,
        to.x + to.w / 2,
        to.y + to.h / 2,
        p.z,
        cfg.noiseRadiusTiles + cfg.noisePerKg * c.weightKg,
        cfg.noiseVolume,
        'action',
      );
    },
  });
}

/** Starts the timed `moveFurniture` action (`sim.pushFurniture` & co.); undefined = started. */
export function startFurnitureMove(
  w: SimWorld,
  eid: number,
  furnitureId: number,
  mode: FurnitureMoveMode,
): CommandRejectReason | undefined {
  const p = furniturePiece(w, furnitureId);
  const c = checkFurnitureMove(w, eid, p, mode);
  if (!c.ok || !p) return c.reason ?? 'invalid-target';
  const a = newAction('moveFurniture');
  a.furniture = {
    origin: p.origin,
    mode: MODES.indexOf(mode),
    dir: sideOf(p.rect, w.c.Position.x[eid] ?? 0, w.c.Position.y[eid] ?? 0),
  };
  a.fixture = [p.x, p.y, p.z, p.n];
  return startAction(w, eid, a);
}

/** `sim.canMoveFurniture`: the same check as the action start (pure). */
export function canMoveFurniture(
  w: SimWorld,
  eid: number,
  furnitureId: number,
  mode: FurnitureMoveMode,
): FurnitureMoveCheck {
  return checkFurnitureMove(w, eid, furniturePiece(w, furnitureId), mode);
}

// ── Crowd ────────────────────────────────────────────────────────────────────────────────

/**
 * Moved furniture standing on tile (tx, ty, z) (the tile behind a pressed door): the piece, or
 * undefined. Only moved pieces count (map furniture keeps the behaviour of existing maps).
 */
export function movedPieceOn(w: SimWorld, tx: number, ty: number, z: number): Piece | undefined {
  const pw = w.physics;
  if (pw.furnitureMoves.size === 0 || !w.furniture) return undefined;
  for (const key of [...pw.furnitureMoves.keys()].sort()) {
    const m = pw.furnitureMoves.get(key)!;
    if (m.z !== z) continue;
    const s = w.furniture.sizeOf(m.contentId, m.rot);
    if (inRect({ x: m.x, y: m.y, w: s.w, h: s.h }, tx, ty)) return pieceByOrigin(w, key);
  }
  return undefined;
}

/** Crowd resistance (zombie units) of a moved piece behind a door; 0 without one. */
export function furnitureDoorResist(w: SimWorld, p: Piece | undefined): number {
  if (!p) return 0;
  const cfg = w.physics.cfg;
  return (furnitureWeightKg(w, p) / cfg.refMassKg) * cfg.furniture.doorResistPerUnit;
}

/** The crowd shoves `p` one tile by (dx, dy) when nothing blocks it; true when it moved. */
export function crowdPushFurniture(w: SimWorld, p: Piece, dx: number, dy: number): boolean {
  const to = { ...p.rect, x: p.rect.x + dx, y: p.rect.y + dy };
  if (placementBlocked(w, gridOf(w), p, to, dx, dy, -1)) return false;
  applyMove(w, p, to, p.rot, 'crowd', undefined);
  return true;
}

/** After loading a save: forget caches built for the map before the moves were restored. */
export function furnitureLoaded(w: SimWorld): void {
  const pw = w.physics;
  pw.furnitureRev++;
  const f = w.furniture;
  if (!f || pw.furnitureMoves.size === 0) return;
  const grids = navGrids.get(w) ?? new Set<TileGrid>();
  grids.add(gridOf(w));
  for (const [key, m] of pw.furnitureMoves) {
    const o = parseOrigin(key);
    f.invalidate(o.cx, o.cy, o.z);
    f.invalidate(Math.floor(m.x / CHUNK_SIZE), Math.floor(m.y / CHUNK_SIZE), m.z);
    for (const g of grids) {
      invalidateNavArea(
        g,
        o.z,
        o.cx * CHUNK_SIZE - 4,
        o.cy * CHUNK_SIZE - 4,
        o.cx * CHUNK_SIZE + CHUNK_SIZE + 3,
        o.cy * CHUNK_SIZE + CHUNK_SIZE + 3,
      );
      invalidateNavArea(g, m.z, m.x - 4, m.y - 4, m.x + 7, m.y + 7);
    }
  }
}
