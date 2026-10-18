import type { FurnitureSource, FurnitureView, FurnTile } from './furniture-api.js';

/** Cursor pick radius around an object's tile centre (tiles): furniture is drawn up to ~1 m tall. */
export const PICK_RADIUS = 0.75;
/** Cursor pick radius around an edge centre (doors, windows, gates). */
export const EDGE_PICK_RADIUS = 0.6;
/** Margin around occupied tiles when picking by footprint (tiles). */
const FOOTPRINT_MARGIN = 0.15;

/** Client-only entries (actions the sim does not list yet) and how to run them. */
export interface LocalFurniture {
  list: () => readonly FurnitureView[];
  use: (view: FurnitureView, actionId: string) => void;
}

export interface SimFurnitureOptions {
  /** `SimViewPatch.furnitureActions` (last full list). */
  list: () => readonly FurnitureView[];
  /** `client.useFurniture`. */
  useFurniture: (furnitureId: number, actionId: string) => void;
  local?: LocalFurniture;
  /**
   * Occupied tiles of a map object when `worldSettings.furnitureFootprint` is on (multi-tile
   * furniture is picked on any of its tiles); undefined = one tile around `x`/`y`.
   */
  footprint?: (view: FurnitureView) => readonly FurnTile[] | undefined;
}

const isEdge = (v: FurnitureView): boolean => v.contentId === undefined;

/**
 * The menu's source: the sim's `furnitureActions` (everything in reach, nearest to the aim point
 * first) picked by the cursor, plus client-only entries; `use` sends `useFurniture`.
 */
export class SimFurnitureSource implements FurnitureSource {
  constructor(private readonly opts: SimFurnitureOptions) {}

  at(x: number, y: number, z: number): FurnitureView | undefined {
    let best: { d: number; v: FurnitureView } | undefined;
    const consider = (v: FurnitureView): void => {
      if (v.z !== z || v.actions.length === 0) return;
      const d = this.pickDistance(v, x, y);
      if (d !== undefined && (!best || d < best.d)) best = { d, v };
    };
    for (const v of this.opts.list()) consider(v);
    for (const v of this.opts.local?.list() ?? []) consider(v);
    return best?.v;
  }

  byId(furnitureId: number): FurnitureView | undefined {
    return (
      this.opts.list().find((v) => v.furnitureId === furnitureId) ??
      this.opts.local?.list().find((v) => v.furnitureId === furnitureId)
    );
  }

  use(view: FurnitureView, actionId: string): void {
    if (this.opts.local?.list().some((v) => v.furnitureId === view.furnitureId))
      this.opts.local.use(view, actionId);
    else this.opts.useFurniture(view.furnitureId, actionId);
  }

  /** Distance from the cursor used to rank entries; undefined = not under the cursor. */
  private pickDistance(v: FurnitureView, x: number, y: number): number | undefined {
    const centre = Math.hypot(v.x - x, v.y - y);
    if (isEdge(v)) return centre <= EDGE_PICK_RADIUS ? centre : undefined;
    const tiles = this.opts.footprint?.(v);
    if (tiles && tiles.length > 1) {
      const m = FOOTPRINT_MARGIN;
      const inside = tiles.some(
        (t) => x >= t.x - m && x <= t.x + 1 + m && y >= t.y - m && y <= t.y + 1 + m,
      );
      // Inside the footprint: rank by the nearest occupied tile centre.
      return inside
        ? Math.min(...tiles.map((t) => Math.hypot(t.x + 0.5 - x, t.y + 0.5 - y)))
        : undefined;
    }
    return centre <= PICK_RADIUS ? centre : undefined;
  }
}
