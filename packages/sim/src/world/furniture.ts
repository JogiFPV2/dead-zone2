import { CHUNK_SIZE, type SimMap } from '@deadzone/protocol';
import { footprintOf, rotatedFootprint } from '@deadzone/content/footprint';
import type { ContentIndex } from '../content/adapter.js';

/**
 * Furniture footprint (docs 9.49, `worldSettings.furnitureFootprint`): map objects that are
 * furniture occupy the tiles of their rotated footprint (`@deadzone/content/footprint`, anchor =
 * north-west tile). Occupied tiles block movement and paths; `tall` furniture also blocks sight.
 * Derived from the map and content only (no state, nothing saved or hashed), built lazily per
 * chunk. Absent (`w.furniture` undefined) when the flag is off: the sim then behaves exactly as
 * before (map objects are points on their tile and block nothing).
 */

/** Tile flags of `FurnitureIndex.flags`. */
export const FF = { blocks: 1, tall: 2 } as const;

/** Furniture definition of a content id (undefined = not furniture: radio, lamp, VCR…). */
export interface FurnitureDef {
  readonly w: number;
  readonly h: number;
  readonly tall: boolean;
  /** Used only from the sides along the longer edge (shop counter: customer and clerk). */
  readonly longSide: boolean;
}

/** Occupied rectangle in world tiles: x0 ≤ tx < x0 + w, y0 ≤ ty < y0 + h. */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Reach only across the longer edges (`FurnitureDef.longSide`). */
  readonly longSide?: boolean | undefined;
}

const CHUNK_TILES = CHUNK_SIZE * CHUNK_SIZE;
/** Max footprint side (`FOOTPRINT_MAX_TILES`): objects reach at most 3 tiles past the anchor. */
const MAX_SIDE = 4;

const chunkKey = (cx: number, cy: number, z: number): string => `${cx},${cy},${z}`;

export class FurnitureIndex {
  private readonly masks = new Map<string, Uint8Array>();

  constructor(
    private readonly map: SimMap,
    readonly resolve: (contentId: string) => FurnitureDef | undefined,
  ) {}

  /** Rotated size of a furniture object (1×1 for anything that is not furniture). */
  sizeOf(contentId: string, rot: number | undefined): { w: number; h: number; longSide: boolean } {
    const d = this.resolve(contentId);
    return d
      ? { ...rotatedFootprint(rot ?? 0, d), longSide: d.longSide }
      : { w: 1, h: 1, longSide: false };
  }

  /** `FF` flags of world tile (tx, ty, z). */
  flags(tx: number, ty: number, z: number): number {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    const m = this.mask(cx, cy, z);
    return m ? (m[(ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE)] ?? 0) : 0;
  }

  /** Drops the cached masks of chunk (cx, cy, z) and the chunks its objects can reach. */
  invalidate(cx: number, cy: number, z: number): void {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const)
      this.masks.delete(chunkKey(cx + dx, cy + dy, z));
  }

  private mask(cx: number, cy: number, z: number): Uint8Array | undefined {
    const key = chunkKey(cx, cy, z);
    const hit = this.masks.get(key);
    if (hit) return hit.length > 0 ? hit : undefined;
    const x0 = cx * CHUNK_SIZE;
    const y0 = cy * CHUNK_SIZE;
    let out: Uint8Array | undefined;
    // An object anchored in the W / N / NW neighbour can reach into this chunk (≤ 3 tiles).
    const complete = this.map.getChunk(cx, cy, z) !== undefined;
    for (let ny = cy - 1; ny <= cy; ny++) {
      for (let nx = cx - 1; nx <= cx; nx++) {
        const chunk = this.map.getChunk(nx, ny, z);
        if (!chunk) continue;
        for (const o of chunk.objects ?? []) {
          const d = this.resolve(o.contentId);
          if (!d) continue;
          const r = rotatedFootprint(o.rot ?? 0, d);
          const ax = nx * CHUNK_SIZE + o.x;
          const ay = ny * CHUNK_SIZE + o.y;
          const f = FF.blocks | (d.tall ? FF.tall : 0);
          for (let ty = Math.max(ay, y0); ty < Math.min(ay + r.h, y0 + CHUNK_SIZE); ty++) {
            for (let tx = Math.max(ax, x0); tx < Math.min(ax + r.w, x0 + CHUNK_SIZE); tx++) {
              out ??= new Uint8Array(CHUNK_TILES);
              const i = (ty - y0) * CHUNK_SIZE + (tx - x0);
              out[i] = (out[i] ?? 0) | f;
            }
          }
        }
      }
    }
    // Lazy worlds: do not cache before the chunk itself is loaded.
    if (complete) this.masks.set(key, out ?? new Uint8Array(0));
    return out;
  }
}

/**
 * Squared distance from (px, py) to the nearest centre of a tile of `r` (1×1 = the tile centre,
 * as before the footprint). Reach "from every neighbouring tile": any tile touching the
 * rectangle (also diagonally) has its centre within √2 < 1.5 of an occupied tile centre.
 */
export function rectDist2(r: TileRect, px: number, py: number): number {
  if (r.longSide && r.w !== r.h) {
    // Only from beside a long edge: the player's projection must fall on that edge.
    const alongX = r.w > r.h;
    const p = alongX ? px : py;
    const lo = alongX ? r.x : r.y;
    if (p < lo || p > lo + (alongX ? r.w : r.h)) return Infinity;
  }
  const cx = Math.min(Math.max(px, r.x + 0.5), r.x + r.w - 0.5);
  const cy = Math.min(Math.max(py, r.y + 0.5), r.y + r.h - 0.5);
  return (cx - px) * (cx - px) + (cy - py) * (cy - py);
}

/** Furniture definitions from content: storage types and placeables that are furniture. */
export function furnitureResolver(
  content: ContentIndex,
): (contentId: string) => FurnitureDef | undefined {
  const tall = new Set<string>(content.furniture.tall);
  const longSide = new Set<string>(content.furniture.longSide);
  const cache = new Map<string, FurnitureDef | undefined>();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    let def: FurnitureDef | undefined;
    const ti = content.containerTypeIndex.get(id);
    const ct = ti === undefined ? undefined : content.containerTypes[ti];
    if (ct) {
      def = { ...clamp(footprintOf(ct)), tall: tall.has(id), longSide: longSide.has(id) };
    } else {
      const item = content.items[content.itemIndex.get(id) ?? -1];
      const p = item?.kind === 'placeable' ? item.placeable : undefined;
      // Furniture = storage, a bed / sofa, a station or an explicit footprint. Small placeables
      // (lamps, radios, VCRs) stand on other furniture and block nothing.
      if (p && (p.containerType || p.sleepSurface || p.station || p.footprint))
        def = {
          ...clamp(footprintOf(item)),
          tall: tall.has(id),
          longSide: longSide.has(id),
        };
    }
    cache.set(id, def);
    return def;
  };
}

const clamp = (fp: { w: number; h: number }): { w: number; h: number } => ({
  w: Math.min(MAX_SIDE, Math.max(1, fp.w | 0)),
  h: Math.min(MAX_SIDE, Math.max(1, fp.h | 0)),
});

/** The index for a sim, or undefined when `worldSettings.furnitureFootprint` is off. */
export function createFurnitureIndex(
  map: SimMap,
  content: ContentIndex | undefined,
): FurnitureIndex | undefined {
  if (!content?.furniture.footprint) return undefined;
  return new FurnitureIndex(map, furnitureResolver(content));
}
