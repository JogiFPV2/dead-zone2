import { CHUNK_SIZE, type SimChunk, type SimMap, type SimMapObject } from '@deadzone/protocol';
import type { FurnitureMove, PhysicsWorld } from './types.js';

/**
 * Moved furniture over the static map (docs 9.61): `getChunk` of the wrapped map returns the
 * chunk with each moved object taken out of its origin chunk and appended (origin key order) to
 * the chunk of its new north-west tile, with new local coordinates and `rot`. Every system that
 * reads `map.getChunk(...).objects` (menu, footprint, sleep, loot, water, crafting) sees the new
 * placement. Chunks no move touches are returned as they are (same object, no copy).
 */

/** Origin key of object `i` of chunk (cx, cy, z) in the static map. */
export const originKey = (cx: number, cy: number, z: number, i: number): string =>
  `${cx},${cy},${z},${i}`;

export function parseOrigin(key: string): { cx: number; cy: number; z: number; i: number } {
  const [cx, cy, z, i] = key.split(',').map(Number) as [number, number, number, number];
  return { cx, cy, z, i };
}

const ck = (cx: number, cy: number, z: number): string => `${cx},${cy},${z}`;

/** Origin keys of the objects of a patched chunk (same order as its `objects`). */
const origins = new WeakMap<SimChunk, readonly string[]>();
/** The unpatched (static) chunk of a patched one. */
const bases = new WeakMap<SimChunk, SimChunk>();
/** Static map under an overlay. */
const baseMaps = new WeakMap<SimMap, SimMap>();

/** Origin key of `objects[i]` of chunk (cx, cy, z) as returned by an overlay `getChunk`. */
export function objectOrigin(
  chunk: SimChunk,
  cx: number,
  cy: number,
  z: number,
  i: number,
): string {
  return origins.get(chunk)?.[i] ?? originKey(cx, cy, z, i);
}

/** The static map under `map` (itself when not an overlay). */
export const baseMapOf = (map: SimMap): SimMap => baseMaps.get(map) ?? map;

export function furnitureOverlay(base: SimMap, pw: PhysicsWorld): SimMap {
  let rev = -1;
  let moves: Map<string, FurnitureMove> | undefined;
  /** Chunk → origin keys leaving it / arriving in it (sorted). */
  const leaving = new Map<string, Set<number>>();
  const arriving = new Map<string, string[]>();
  const cache = new Map<string, SimChunk>();
  const refresh = (): void => {
    if (rev === pw.furnitureRev && moves === pw.furnitureMoves) return;
    rev = pw.furnitureRev;
    moves = pw.furnitureMoves;
    leaving.clear();
    arriving.clear();
    cache.clear();
    for (const key of [...moves.keys()].sort()) {
      const m = moves.get(key)!;
      const o = parseOrigin(key);
      const from = ck(o.cx, o.cy, o.z);
      let l = leaving.get(from);
      if (!l) leaving.set(from, (l = new Set()));
      l.add(o.i);
      const to = ck(Math.floor(m.x / CHUNK_SIZE), Math.floor(m.y / CHUNK_SIZE), m.z);
      let a = arriving.get(to);
      if (!a) arriving.set(to, (a = []));
      a.push(key);
    }
  };
  const overlay: SimMap = {
    ...base,
    getChunk(cx, cy, z) {
      const c = base.getChunk(cx, cy, z);
      if (!c || pw.furnitureMoves.size === 0) return c;
      refresh();
      const key = ck(cx, cy, z);
      const out = leaving.get(key);
      const inn = arriving.get(key);
      if (!out && !inn) return c;
      const hit = cache.get(key);
      if (hit && bases.get(hit) === c) return hit;
      const objects: SimMapObject[] = [];
      const keys: string[] = [];
      (c.objects ?? []).forEach((o, i) => {
        if (out?.has(i)) return;
        objects.push(o);
        keys.push(originKey(cx, cy, z, i));
      });
      for (const k of inn ?? []) {
        const m = moves!.get(k)!;
        objects.push({
          contentId: m.contentId,
          x: m.x - cx * CHUNK_SIZE,
          y: m.y - cy * CHUNK_SIZE,
          ...(m.rot ? { rot: m.rot } : {}),
        });
        keys.push(k);
      }
      const patched: SimChunk = { ...c, objects };
      origins.set(patched, keys);
      bases.set(patched, c);
      cache.set(key, patched);
      return patched;
    },
  };
  baseMaps.set(overlay, base);
  return overlay;
}
