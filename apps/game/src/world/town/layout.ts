import {
  CHUNK_SIZE,
  NO_BUILDING,
  type BuildingId,
  type ChunkRange,
  type ContentId,
  type EdgeKind,
} from '../chunk.js';
import type { EdgeAxis } from '../building-lookup.js';
import type { Footprint } from './roof.js';
import { roofStyle, skinOfWall, type RoofStyle, type Skin } from './modules.js';
import type { MapTiles } from './tiles.js';

/** One wall / window / doorway edge with its look inputs. */
export interface TownEdge {
  kind: EdgeKind;
  content: ContentId;
  axis: EdgeAxis;
  tx: number;
  ty: number;
  /** Owning building (cutaway), NO_BUILDING for free-standing walls. */
  building: BuildingId;
  /** Both sides are rooms of the same building. */
  interior: boolean;
  skin: Skin;
}

export interface TownRoof {
  building: BuildingId;
  style: RoofStyle;
  footprint: Footprint;
  /** Footprint is a full rectangle (else pitched roofs fall back to flat). */
  rect: boolean;
  tiles: { tx: number; ty: number }[];
}

export interface TownLayout {
  edges: TownEdge[];
  roofs: TownRoof[];
  skins: ReadonlyMap<BuildingId, Skin>;
}

/**
 * Reads walls, windows, doorways and roofs of a chunk range for the town renderer: building
 * skins (most common exterior wall content), interior edges and roof footprints.
 * Fences are not here (opening pieces, world/openings.ts).
 */
export function layoutTown(tiles: MapTiles, range: ChunkRange): TownLayout {
  const raw: Omit<TownEdge, 'skin'>[] = [];
  const wallVotes = new Map<BuildingId, Map<ContentId, number>>();
  const roofTiles = new Map<BuildingId, { tx: number; ty: number; roof: ContentId }[]>();
  const tx0 = range.cx0 * CHUNK_SIZE;
  const ty0 = range.cy0 * CHUNK_SIZE;
  const tx1 = (range.cx1 + 1) * CHUNK_SIZE;
  const ty1 = (range.cy1 + 1) * CHUNK_SIZE;
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      for (const axis of ['N', 'W'] as const) {
        const def = tiles.edge(axis, tx, ty);
        if (!def || def.kind === 'fence') continue;
        const own = tiles.building(tx, ty);
        const other = axis === 'N' ? tiles.building(tx, ty - 1) : tiles.building(tx - 1, ty);
        const building = own !== NO_BUILDING ? own : other;
        const interior = own !== NO_BUILDING && own === other;
        raw.push({ kind: def.kind, content: def.id, axis, tx, ty, building, interior });
        if (def.kind === 'wall' && !interior && building !== NO_BUILDING) {
          let v = wallVotes.get(building);
          if (!v) wallVotes.set(building, (v = new Map<ContentId, number>()));
          v.set(def.id, (v.get(def.id) ?? 0) + 1);
        }
      }
      const roof = tiles.roof(tx, ty);
      if (roof) {
        const b = tiles.building(tx, ty);
        let list = roofTiles.get(b);
        if (!list) roofTiles.set(b, (list = []));
        list.push({ tx, ty, roof });
      }
    }
  }
  const skins = new Map<BuildingId, Skin>();
  for (const [b, votes] of wallVotes) {
    const best = [...votes].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0];
    skins.set(b, skinOfWall(best, b));
  }
  const edges = raw.map((e): TownEdge => {
    const skin: Skin = e.interior
      ? 'interior'
      : (skins.get(e.building) ??
        skinOfWall(e.kind === 'wall' ? e.content : undefined, e.building));
    return { ...e, skin };
  });
  const roofs: TownRoof[] = [];
  for (const [building, list] of roofTiles) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    const votes = new Map<ContentId, number>();
    for (const t of list) {
      x0 = Math.min(x0, t.tx);
      z0 = Math.min(z0, t.ty);
      x1 = Math.max(x1, t.tx);
      z1 = Math.max(z1, t.ty);
      votes.set(t.roof, (votes.get(t.roof) ?? 0) + 1);
    }
    const roof = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
    const rect = list.length === (x1 - x0 + 1) * (z1 - z0 + 1) && building !== NO_BUILDING;
    roofs.push({
      building,
      style: roofStyle(roof),
      footprint: { x0, z0, x1, z1 },
      rect,
      tiles: list.map(({ tx, ty }) => ({ tx, ty })),
    });
  }
  roofs.sort((a, b) => a.building - b.building);
  return { edges, roofs, skins };
}
