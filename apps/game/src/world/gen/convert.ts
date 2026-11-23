import type { SimChunk } from '@deadzone/protocol';
import type { GenColumn, GenLevel } from '@deadzone/map/world-source';
import type { ChunkData, ContentId, RoomInfo, TileId } from '../chunk.js';
import type { BuildingMeta, DecorInstance, VectorRoad, WorldChunk } from '../streaming/source.js';
import { GROUND_TILES } from '@deadzone/map/world-source';

/** Decor kind of plan trees (the town kit draws its tree props for it). */
export const TREE_DECOR: ContentId = 'base:tree';

/** Building render metadata (`BuildingMeta`) plus what the streamed town needs (pitched roofs). */
export interface GenBuildingInfo extends BuildingMeta {
  /** Footprint fills its bounding box: a pitched roof may span the whole building. */
  readonly rect: boolean;
  /** Slanted building with vector walls: outline (x, y pairs, world metres), flat roof. */
  readonly outline?: readonly number[];
  /** Courtyards of `outline` (inner rings). */
  readonly holes?: readonly (readonly number[])[];
  /** Building kind (`block`, `house`…; the block facade). */
  readonly kind?: string;
}

function levelData(cx: number, cy: number, l: GenLevel): ChunkData {
  const rooms = new Map<number, RoomInfo>();
  for (const [id, type, buildingId] of l.rooms)
    rooms.set(id, { type: type as ContentId, buildingId });
  return {
    coord: { cx, cy, z: l.z },
    floor: l.floor,
    edgeN: l.edgeN,
    edgeW: l.edgeW,
    ...(l.roof ? { roof: l.roof } : {}),
    ...(l.room ? { room: l.room, rooms } : {}),
    ...(l.buildingKinds?.length ? { buildingKinds: new Map(l.buildingKinds) } : {}),
    ...(l.objects.length
      ? { objects: l.objects.map((o) => ({ ...o, contentId: o.contentId as ContentId })) }
      : {}),
    ...(l.stairs.length ? { stairs: l.stairs } : {}),
    ...(l.vehicles?.length ? { vehicles: l.vehicles } : {}),
    ...(l.wallSegments?.length ? { wallSegments: l.wallSegments } : {}),
  };
}

/** Generator column → the streamer's `WorldChunk` (levels, trees as decor, building metadata). */
export function columnToWorldChunk(col: GenColumn): WorldChunk {
  const levels = new Map<number, ChunkData>();
  for (const l of col.levels) levels.set(l.z, levelData(col.cx, col.cy, l));
  const decor: DecorInstance[] = [];
  for (let i = 0; i + 1 < col.trees.length; i += 2) {
    const x = col.trees[i]!;
    const y = col.trees[i + 1]!;
    const sp = col.treeSpecies?.[i >> 1];
    decor.push({ kind: TREE_DECOR, x, y, z: 0, rot: 0, scale: 1, ...(sp ? { species: sp } : {}) });
  }
  const buildings: GenBuildingInfo[] = col.buildings.map((b) => ({
    id: b.id,
    x0: b.x0,
    y0: b.y0,
    x1: b.x1,
    y1: b.y1,
    floors: b.floors,
    rect: b.rect,
    kind: b.kind,
    ...(b.outline ? { outline: b.outline } : {}),
    ...(b.holes ? { holes: b.holes } : {}),
    ...(b.look ? { look: b.look } : {}),
    ...(b.wallColor ? { wallColor: b.wallColor } : {}),
    ...(b.roofColor ? { roofColor: b.roofColor } : {}),
    ...(b.trimColor ? { trimColor: b.trimColor } : {}),
    ...(b.roofShape ? { roofShape: b.roofShape } : {}),
    ...(b.condition ? { condition: b.condition } : {}),
    ...(b.heightM ? { heightM: b.heightM } : {}),
    ...(b.tower ? { tower: b.tower } : {}),
  }));
  const roads: VectorRoad[] | undefined = col.roads?.map((r) => ({
    surface: GROUND_TILES[r.ground] ?? 'base:asphalt',
    r: r.r,
    rs: r.rs,
    bridge: r.bridge,
    pts: r.pts,
    d0: r.d0,
    ...(r.cl === 0 ? { cl: r.cl } : {}),
    ...(r.ll ? { ll: r.ll } : {}),
    ...(r.look === 1
      ? { look: 'gravel' as const }
      : r.look === 2
        ? { look: 'trail' as const }
        : {}),
  }));
  const zones = col.levels.find((l) => l.z === 0)?.zones;
  const bushes = zones?.filter((zn) => zn.role === 'bushes').flatMap((zn) => zn.rects);
  const woods = zones?.filter((zn) => zn.role === 'cover').flatMap((zn) => zn.rects);
  return {
    cx: col.cx,
    cy: col.cy,
    levels,
    decor,
    buildings,
    ...(bushes?.length ? { bushes } : {}),
    ...(woods?.length ? { woods } : {}),
    ...(roads?.length ? { roads } : {}),
    ...(col.under ? { under: col.under } : {}),
    ...(col.areas?.length
      ? {
          areas: col.areas.map((a) => ({
            surface: GROUND_TILES[a.ground] ?? 'base:grass',
            order: a.order,
            rings: a.rings,
          })),
        }
      : {}),
    ...(col.infra ? { infra: col.infra } : {}),
    ...(col.lamps?.length ? { lamps: col.lamps } : {}),
  };
}

/** Array buffers of a column (transferred from the worker, zero copy). */
export function columnBuffers(col: GenColumn): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const l of col.levels)
    for (const a of [l.floor, l.edgeN, l.edgeW, l.roof, l.room])
      if (a) out.add(a.buffer as ArrayBuffer);
  if (col.under) out.add(col.under.buffer as ArrayBuffer);
  return [...out];
}

/**
 * One storey of a column as the sim's `SimChunk`: water has no floor (0 = blocked: you cannot
 * walk into the river), room ids stay chunk-local with `roomBuildings` → global building id.
 */
export function levelToSimChunk(l: GenLevel, waterTile: TileId): SimChunk {
  let floor = l.floor;
  if (waterTile > 0 && l.z === 0 && l.floor.includes(waterTile)) {
    floor = Uint16Array.from(l.floor, (v) => (v === waterTile ? 0 : v));
  }
  const rooms: Record<string, string> = {};
  const roomBuildings: Record<string, number> = {};
  for (const [id, type, b] of l.rooms) {
    rooms[String(id)] = type;
    roomBuildings[String(id)] = b;
  }
  return {
    floor,
    edgeN: l.edgeN,
    edgeW: l.edgeW,
    ...(l.room ? { room: l.room, rooms, roomBuildings } : {}),
    ...(l.room && l.buildingKinds?.length
      ? { buildingKinds: Object.fromEntries(l.buildingKinds.map(([b, k]) => [String(b), k])) }
      : {}),
    ...(l.objects.length
      ? {
          // rot too: a rotated bed / table takes its turned footprint in the sim (window-pass).
          objects: l.objects.map(({ contentId, x, y, rot }) => ({
            contentId,
            x,
            y,
            ...(rot ? { rot } : {}),
          })),
        }
      : {}),
    ...(l.stairs.length ? { stairs: l.stairs } : {}),
    ...(l.vehicles?.length ? { vehicles: l.vehicles } : {}),
    ...(l.wallSegments?.length ? { wallSegments: l.wallSegments } : {}),
    ...(l.zones?.length ? { zones: l.zones } : {}),
    ...(l.blockers?.length ? { blockers: l.blockers } : {}),
  };
}
