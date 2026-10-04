import { CHUNK_SIZE, type BuildingId, type ChunkData, type EdgeKind } from './chunk.js';
import type { BuildingLookup, EdgeAxis } from './building-lookup.js';

/** Grey-box structure sizes (world units). */
export const WALL_HEIGHT = 2.8;
export const WINDOW_HEIGHT = 1;
export const LOWERED_HEIGHT = 0.3;
export const WALL_THICKNESS = 0.15;
export const ROOF_THICKNESS = 0.2;

/** One wall-like edge in world tile coordinates. */
export interface EdgeInstance {
  axis: EdgeAxis;
  tx: number;
  ty: number;
  building: BuildingId;
}

export interface EdgeGroup {
  edgeId: number;
  kind: EdgeKind;
  edges: EdgeInstance[];
}

export interface RoofTile {
  tx: number;
  ty: number;
  building: BuildingId;
}

export interface RoofGroup {
  roofId: number;
  tiles: RoofTile[];
}

type KindOf = (edgeId: number) => EdgeKind | undefined;

/** Edges drawn by Structures: doors and fences are separate pieces (world/openings.ts). */
export const STATIC_EDGE = (k: EdgeKind): boolean => k !== 'door' && k !== 'fence';

/** Groups the chunk's N/W edges of the `include`d kinds by edge id (sorted). */
export function collectEdges(
  chunk: ChunkData,
  kindOf: KindOf,
  lookup: BuildingLookup,
  include: (kind: EdgeKind) => boolean = STATIC_EDGE,
): EdgeGroup[] {
  const groups = new Map<number, EdgeGroup>();
  const { cx, cy, z } = chunk.coord;
  const add = (axis: EdgeAxis, layer: Uint16Array | undefined) => {
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) {
      const edgeId = layer[i] ?? 0;
      const kind = edgeId === 0 ? undefined : kindOf(edgeId);
      if (!kind || !include(kind)) continue;
      let g = groups.get(edgeId);
      if (!g) groups.set(edgeId, (g = { edgeId, kind, edges: [] }));
      const tx = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
      const ty = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      g.edges.push({ axis, tx, ty, building: lookup.edge(axis, tx, ty, z) });
    }
  };
  add('N', chunk.edgeN);
  add('W', chunk.edgeW);
  return [...groups.values()].sort((a, b) => a.edgeId - b.edgeId);
}

/** Groups the chunk's roof tiles by roof id (sorted). A roof tile belongs to its room's building. */
export function collectRoofs(chunk: ChunkData, lookup: BuildingLookup): RoofGroup[] {
  const groups = new Map<number, RoofGroup>();
  const { cx, cy, z } = chunk.coord;
  const roof = chunk.roof;
  if (!roof) return [];
  for (let i = 0; i < roof.length; i++) {
    const roofId = roof[i] ?? 0;
    if (roofId === 0) continue;
    let g = groups.get(roofId);
    if (!g) groups.set(roofId, (g = { roofId, tiles: [] }));
    const tx = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
    const ty = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
    g.tiles.push({ tx, ty, building: lookup.at(tx, ty, z) });
  }
  return [...groups.values()].sort((a, b) => a.roofId - b.roofId);
}

/** Writes a scale + translation matrix (column-major) at float offset `o`. */
function writeBox(
  m: Float32Array,
  o: number,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): void {
  m.fill(0, o, o + 16);
  m[o] = sx;
  m[o + 5] = sy;
  m[o + 10] = sz;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

/**
 * Matrix for a unit box (bottom at y = 0) stretched along an edge line, relative to the world
 * point (`ox`, `oz`) (the chunk origin for streamed chunks: floating origin). Edges are 1 + thickness
 * long so corners overlap. N edge of tile (tx, ty): centre (tx + 0.5, ty); W edge: (tx, ty + 0.5).
 */
export function writeEdgeMatrix(
  m: Float32Array,
  o: number,
  e: EdgeInstance,
  baseY: number,
  height: number,
  ox = 0,
  oz = 0,
): void {
  const len = 1 + WALL_THICKNESS;
  const x = e.tx - ox;
  const z = e.ty - oz;
  if (e.axis === 'N') writeBox(m, o, len, height, WALL_THICKNESS, x + 0.5, baseY, z);
  else writeBox(m, o, WALL_THICKNESS, height, len, x, baseY, z + 0.5);
}

/** Roof slab on top of the walls; `hidden` collapses it to zero scale. */
export function writeRoofMatrix(
  m: Float32Array,
  o: number,
  t: RoofTile,
  baseY: number,
  hidden: boolean,
  ox = 0,
  oz = 0,
): void {
  const s = hidden ? 0 : 1;
  writeBox(m, o, s, s * ROOF_THICKNESS, s, t.tx - ox + 0.5, baseY + WALL_HEIGHT, t.ty - oz + 0.5);
}

export const edgeHeight = (kind: EdgeKind, lowered: boolean): number =>
  Math.min(kind === 'window' ? WINDOW_HEIGHT : WALL_HEIGHT, lowered ? LOWERED_HEIGHT : Infinity);
