import type { Box3 } from 'three';
import type { BuildingLookup } from '../building-lookup.js';
import { CHUNK_SIZE, type ChunkSource } from '../chunk.js';
import { cellBox } from './cell-box.js';
import type { TownKit } from './kit.js';
import type { TownEdge } from './layout.js';
import { edgeModule } from './modules.js';
import { cardCategory, cardCell, cardSeed } from './window-card.js';
import { detailWindowCell } from './bld-decals.js';
import { buildingCondition } from './bld-v2.js';

/** Where a window's pane and card go: glass box (module space), inward side, atlas cell. */
export interface PaneSpec {
  box: Box3;
  inward: 1 | -1;
  cell: number;
  /** bld detail: broken / boarded window of an abandoned building, drawn without glass. */
  noGlass?: boolean;
}

const boxes = new WeakMap<TownKit, Map<string, Box3 | null>>();

/** Glass box of a window module (cached per kit), null when the module has no glass. */
export function glassBox(kit: TownKit, name: string): Box3 | null {
  let cache = boxes.get(kit);
  if (!cache) boxes.set(kit, (cache = new Map<string, Box3 | null>()));
  let b = cache.get(name);
  if (b === undefined) {
    const g = kit.geometries.get(name);
    const box = g ? cellBox(g, kit.cells.uv('glass')) : null;
    b = box && !box.isEmpty() ? box : null;
    cache.set(name, b);
  }
  return b;
}

/** Room type of tile (tx, ty) on level z, from the chunk's room layer. */
export function roomTypeAt(source: ChunkSource, tx: number, ty: number, z: number) {
  const cx = Math.floor(tx / CHUNK_SIZE);
  const cy = Math.floor(ty / CHUNK_SIZE);
  const c = source.getChunk(cx, cy, z);
  const id = c?.room?.[(ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE)];
  return id ? c?.rooms?.get(id)?.type : undefined;
}

/**
 * Pane spec of an outside window edge, undefined for interior windows, burnt buildings and modules
 * without glass. Inward: module +z is tile (tx, ty) for both axes (N: rot 0, W: rot +90°).
 */
export function windowPaneSpec(
  kit: TownKit,
  source: ChunkSource,
  lookup: BuildingLookup,
  e: TownEdge,
  z: number,
): PaneSpec | undefined {
  if (e.kind !== 'window' || e.interior || e.skin === 'burnt') return undefined;
  const box = glassBox(kit, edgeModule(e.kind, e.skin, e.content, { lowered: false }));
  if (!box) return undefined;
  const inward: 1 | -1 = lookup.at(e.tx, e.ty, z) === e.building ? 1 : -1;
  const [ix, iy] = inward > 0 ? [e.tx, e.ty] : e.axis === 'N' ? [e.tx, e.ty - 1] : [e.tx - 1, e.ty];
  const seed = cardSeed(e.building, e.tx, e.ty, e.axis);
  const state = detailWindowCell(buildingCondition(e.building), e.building, seed);
  if (state !== undefined) return { box, inward, cell: state, noGlass: true };
  const cat = cardCategory(roomTypeAt(source, ix, iy, z));
  return { box, inward, cell: cardCell(cat, seed) };
}
