import type { FurnitureMoveView, SimEvent } from '@deadzone/protocol';
import { CHUNK_SIZE } from './chunk.js';

export type FurnitureMovedEvent = Extract<SimEvent, { type: 'furnitureMoved' }>;

/** Where a map object stands (anchor = north-west tile, `rot` 0–3). */
export interface FurniturePose {
  contentId: string;
  tx: number;
  ty: number;
  z: number;
  rot: number;
  /** Tiles taken after `rot` as the sim sent them (undefined = from the content footprint). */
  w?: number;
  h?: number;
}

/** Furniture slide / turn on screen after a move the client did not see coming (ms). */
export const FURNITURE_TWEEN_MS = 800;
/** Settle of a piece from where the action preview left it onto its final place (ms). */
export const FURNITURE_SETTLE_MS = 200;

/**
 * Map object id of the sim (`furniture/menu.ts` `objectFurnitureId`, `useFurniture` /
 * `furnitureMoved` ids): anchor tile + index among the objects anchored on that tile.
 */
const OBJECT_ID_BASE = 2 ** 42;
export const objectId = (x: number, y: number, z: number, n: number): number =>
  OBJECT_ID_BASE + (((z + 128) * 0x10000 + (y + 0x8000)) * 0x10000 + (x + 0x8000)) * 16 + n;

export function unpackObjectId(id: number): { x: number; y: number; z: number; n: number } {
  let k = id - OBJECT_ID_BASE;
  const n = k % 16;
  k = (k - n) / 16;
  const x = (k % 0x10000) - 0x8000;
  k = (k - (x + 0x8000)) / 0x10000;
  const y = (k % 0x10000) - 0x8000;
  const z = (k - (y + 0x8000)) / 0x10000 - 128;
  return { x, y, z, n };
}

const poseKey = (contentId: string, tx: number, ty: number, z: number) =>
  `${contentId}@${tx},${ty},${z}`;
const keyOf = (p: FurniturePose) => poseKey(p.contentId, p.tx, p.ty, p.z);
const samePose = (a: FurniturePose, b: FurniturePose) =>
  keyOf(a) === keyOf(b) && (a.rot & 3) === (b.rot & 3);

const chunkOf = (t: number) => Math.floor(t / CHUNK_SIZE);

/** One change of where an object is drawn: from its pose so far to the new one. */
export interface FurnitureShift {
  from: FurniturePose;
  to: FurniturePose;
}

/**
 * Map objects moved by the sim (protocol 37 / 38: `furnitureMoved`, `SimViewPatch.
 * furnitureMoves`), for the render side: the client builds chunks from its own map data, which
 * never sees a move, so loaded / reloaded chunks go through this overlay. An object is keyed by
 * where the map put it (contentId + anchor tile), as the sim's `FurnitureMoveView.from*`.
 * Both the live moves and the full list are idempotent.
 */
export class FurnitureMoves {
  /** Map key → map pose and pose now. */
  private now = new Map<string, { origin: FurniturePose; pose: FurniturePose }>();
  /** Pose key now → map key. */
  private back = new Map<string, string>();

  get size(): number {
    return this.now.size;
  }

  /**
   * A live move of one object from `from` (pose so far) to `to`; nothing when it already stands
   * at `to` (the full list came first). Returns whether it changed anything.
   */
  move(from: FurniturePose, to: FurniturePose): boolean {
    const toKey = keyOf(to);
    const at = this.back.get(toKey);
    if (at !== undefined && samePose(this.now.get(at)!.pose, to)) return false;
    const fromKey = keyOf(from);
    const origin = this.back.get(fromKey) ?? fromKey;
    const entry = this.now.get(origin);
    this.back.delete(fromKey);
    const mapPose: FurniturePose = {
      contentId: from.contentId,
      tx: from.tx,
      ty: from.ty,
      z: from.z,
      rot: from.rot & 3,
    };
    this.now.set(origin, { origin: entry?.origin ?? mapPose, pose: to });
    this.back.set(toKey, origin);
    return true;
  }

  /**
   * The sim's full list (first view after a load, then on every move): replaces the overlay and
   * returns what is drawn elsewhere now (back on its map place = `to` is the map pose). The same
   * list twice gives nothing.
   */
  setAll(list: readonly FurnitureMoveView[]): FurnitureShift[] {
    const next = new Map<string, { origin: FurniturePose; pose: FurniturePose }>();
    for (const v of list) {
      const origin: FurniturePose = {
        contentId: v.contentId,
        tx: v.fromX,
        ty: v.fromY,
        z: v.z,
        rot: v.fromRot & 3,
      };
      const pose: FurniturePose = {
        contentId: v.contentId,
        tx: v.x,
        ty: v.y,
        z: v.z,
        rot: v.rot & 3,
        w: v.w,
        h: v.h,
      };
      next.set(keyOf(origin), { origin, pose });
    }
    const out: FurnitureShift[] = [];
    for (const [k, e] of next) {
      const old = this.now.get(k)?.pose ?? e.origin;
      if (!samePose(old, e.pose)) out.push({ from: old, to: e.pose });
    }
    for (const [k, e] of this.now) {
      if (!next.has(k) && !samePose(e.pose, e.origin)) out.push({ from: e.pose, to: e.origin });
    }
    this.now = next;
    this.back = new Map([...next].map(([k, e]) => [keyOf(e.pose), k]));
    return out;
  }

  /** Whether a map object (as the map data has it) is drawn where the map put it. */
  keepsMapPlace(contentId: string, tx: number, ty: number, z: number): boolean {
    return !this.now.has(poseKey(contentId, tx, ty, z));
  }

  /** Moved objects whose anchor is now in chunk (cx, cy, z). */
  movedInto(cx: number, cy: number, z: number): FurniturePose[] {
    const out: FurniturePose[] = [];
    for (const { pose: p } of this.now.values()) {
      if (p.z === z && chunkOf(p.tx) === cx && chunkOf(p.ty) === cy) out.push(p);
    }
    return out;
  }
}

/** Chunks (`cx,cy`) a move touched: old and new anchors of the piece and what it carried. */
export function movedChunks(e: FurnitureMovedEvent): string[] {
  const out = new Set([
    `${chunkOf(e.fromX)},${chunkOf(e.fromY)}`,
    `${chunkOf(e.x)},${chunkOf(e.y)}`,
  ]);
  for (const c of e.carried ?? []) {
    for (const id of [c.fromId, c.toId]) {
      const t = unpackObjectId(id);
      out.add(`${chunkOf(t.x)},${chunkOf(t.y)}`);
    }
  }
  return [...out];
}

/** The piece's pose before a move (`furnitureMoved` has only the new `rot` and `w` × `h`). */
export function poseBefore(e: FurnitureMovedEvent): FurniturePose {
  const turned = e.cause === 'rotate';
  return {
    contentId: e.contentId,
    tx: e.fromX,
    ty: e.fromY,
    z: e.z,
    rot: turned ? (e.rot + 3) & 3 : e.rot & 3,
    w: turned ? e.h : e.w,
    h: turned ? e.w : e.h,
  };
}

export const poseAfter = (e: FurnitureMovedEvent): FurniturePose => ({
  contentId: e.contentId,
  tx: e.x,
  ty: e.y,
  z: e.z,
  rot: e.rot & 3,
  w: e.w,
  h: e.h,
});

/**
 * Where a thing on the piece's top goes with it (sim #286): the same shift for push / pull; a
 * turn goes clockwise about the piece's north-west tile, local (ox, oy) of the w × h piece →
 * (h − 1 − oy, ox), `rot + 1`.
 */
export function carriedPose(
  piece: { tx: number; ty: number; w: number; h: number },
  item: FurniturePose,
  move: { dx: number; dy: number } | 'rotate',
): FurniturePose {
  if (move !== 'rotate') return { ...item, tx: item.tx + move.dx, ty: item.ty + move.dy };
  const ox = item.tx - piece.tx;
  const oy = item.ty - piece.ty;
  return {
    ...item,
    tx: piece.tx + (piece.h - 1 - oy),
    ty: piece.ty + ox,
    rot: (item.rot + 1) & 3,
  };
}

/** Smooth 0..1 (ease in-out) of a tween at `k` 0..1. */
export function easeMove(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
}

/** Shortest turn from yaw `a` to yaw `b` (rad), so a 3 → 0 turn goes 90°, not 270°. */
export function turnTo(a: number, b: number, k: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * easeMove(k);
}
