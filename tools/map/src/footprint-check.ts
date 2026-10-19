import { STAIR_STEP } from '@deadzone/content';
import { occupiedTiles, type Footprint } from '@deadzone/content/footprint';
import { OVERLAY_OBJECTS, type FurnishView, type PlacedObject } from './furnish.js';

/**
 * Footprint checks of placed furniture (spec: footprint mebli, #218), shared by the furnishing
 * tests, the content-map test and the world-generator sample test:
 * - `overlap`: two objects cover one tile (counted per extra cover),
 * - `room`: a piece of indoor furniture (anchor in a room) covers a tile of another room or
 *   outside rooms (or an outdoor prop reaches into a room),
 * - `door`: a covered tile is a door tile or the tile in front of a door (both sides),
 * - `stairs`: a covered tile is a stair run, its foot or its landing.
 * Overlay objects (`OVERLAY_OBJECTS`: a ceiling lamp, a desk lamp on its desk) cover no tile:
 * only their own tile is checked for room / door / stairs, never for overlaps.
 */
export interface FootprintIssue {
  kind: 'overlap' | 'room' | 'door' | 'stairs';
  at: string;
}

const SIDES = [
  ['n', 0, -1],
  ['e', 1, 0],
  ['s', 0, 1],
  ['w', -1, 0],
] as const;
const k = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** Door sides and stair tiles of a view (never covered by furniture). */
export function blockedTiles(view: FurnishView): { doors: Set<string>; stairs: Set<string> } {
  const doors = new Set<string>();
  const stairs = new Set<string>();
  for (const z of view.levels)
    for (const [x, y] of view.tiles(z))
      for (const [s, dx, dy] of SIDES) {
        if (view.edge(x, y, z, s) !== 'door') continue;
        doors.add(k(x, y, z));
        doors.add(k(x + dx, y + dy, z));
      }
  for (const s of view.stairs) {
    const [dx, dy] = STAIR_STEP[s.dir];
    stairs.add(k(s.x - dx, s.y - dy, s.z));
    stairs.add(k(s.x + dx * s.len, s.y + dy * s.len, s.z + 1));
    for (let i = 0; i < s.len; i++) {
      stairs.add(k(s.x + dx * i, s.y + dy * i, s.z));
      stairs.add(k(s.x + dx * i, s.y + dy * i, s.z + 1));
    }
  }
  return { doors, stairs };
}

/** Every footprint issue of `objs` on `view` (empty = clean). */
export function footprintIssues(
  view: FurnishView,
  objs: readonly PlacedObject[],
  footprint: (contentId: string) => Footprint,
  opt: { stairs?: boolean } = {},
): FootprintIssue[] {
  const out: FootprintIssue[] = [];
  const { doors, stairs } = blockedTiles(view);
  const cover = new Map<string, string>();
  for (const o of objs) {
    const at = `${o.contentId} (${o.x}, ${o.y}, z ${o.z}, rot ${o.rot})`;
    const room = view.room(o.x, o.y, o.z);
    if (OVERLAY_OBJECTS.has(o.contentId)) {
      const tk = k(o.x, o.y, o.z);
      if (doors.has(tk)) out.push({ kind: 'door', at: `${at} @ ${tk}` });
      if (opt.stairs !== false && stairs.has(tk)) out.push({ kind: 'stairs', at: `${at} @ ${tk}` });
      continue;
    }
    for (const t of occupiedTiles(o.x, o.y, o.rot, footprint(o.contentId))) {
      const tk = k(t.x, t.y, o.z);
      const prev = cover.get(tk);
      if (prev !== undefined) out.push({ kind: 'overlap', at: `${at} × ${prev} @ ${tk}` });
      else cover.set(tk, at);
      if (view.room(t.x, t.y, o.z) !== room) out.push({ kind: 'room', at: `${at} @ ${tk}` });
      if (doors.has(tk)) out.push({ kind: 'door', at: `${at} @ ${tk}` });
      if (opt.stairs !== false && stairs.has(tk)) out.push({ kind: 'stairs', at: `${at} @ ${tk}` });
    }
  }
  return out;
}
