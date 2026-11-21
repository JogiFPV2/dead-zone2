import { buildingIdAt, CHUNK_SIZE, roomIdAt, type SimChunk, type SimMap } from '@deadzone/protocol';
import {
  baseState,
  coverBlocksSight,
  createOpeningsWorld,
  DEFAULT_OPENINGS_CONFIG,
  EF,
  openingFlags,
  openingKey,
  type OpeningsWorld,
} from '../openings/state.js';
import { STAIR_STEP, type Stair } from './levels.js';
import { FF, type FurnitureIndex } from './furniture.js';

const WALL = EF.present | EF.blocksMove | EF.blocksSight | EF.muffles;

/** Numeric tile key (|tx|, |ty| < 2^20, z in −128..127): no string building on hot paths. */
const stairKey = (tx: number, ty: number, z: number): number =>
  ((tx + 0x100000) * 0x200000 + (ty + 0x100000)) * 256 + (z + 128);

/** Segment keys start below every blocker key (`forBlockers`: > −2^42). */
const SEGMENT_KEY_BASE = -(2 ** 46);

/**
 * Resolves world tile coordinates to a chunk and a layer index (floor division for negatives).
 * Doors and windows (`SimMap.edgeKinds`) take their flags from the openings state (world state,
 * `w.openings`); without one every door / window is in the map default state `closed`.
 */
export class TileGrid {
  private lastCx = Number.NaN;
  private lastCy = Number.NaN;
  private lastZ = Number.NaN;
  private lastChunk: SimChunk | undefined;
  readonly openings: OpeningsWorld;
  /**
   * Flights of stairs from `SimChunk.stairs` (world tiles), in chunk list order; on lazy worlds
   * (sim LOD) appended per chunk by `addChunkStairs` in a saved order.
   */
  readonly stairs: readonly Stair[];
  private readonly stairList: Stair[] = [];
  /** Tile key (`stairKey`, base level) → index in `stairs`. */
  private readonly stairTiles = new Map<number, number>();
  /** Chunks on more than one level (`listChunks`; the LOD sets it for multi-level worlds). */
  multiLevel: boolean;

  constructor(
    private readonly map: SimMap,
    openings?: OpeningsWorld,
    /** Furniture footprint (`w.furniture`); undefined = furniture blocks nothing (flag off). */
    readonly furniture?: FurnitureIndex,
  ) {
    this.openings = openings ?? createOpeningsWorld(map, DEFAULT_OPENINGS_CONFIG);
    this.stairs = this.stairList;
    const levels = new Set<number>();
    for (const a of map.listChunks?.() ?? []) {
      levels.add(a.z);
      this.addChunkStairs(a.cx, a.cy, a.z);
    }
    this.multiLevel = levels.size > 1;
  }

  /** Registers the flights of stairs of chunk (cx, cy, z) (call once per chunk). */
  addChunkStairs(cx: number, cy: number, z: number): void {
    const stairs = this.stairList;
    for (const st of this.map.getChunk(cx, cy, z)?.stairs ?? []) {
      const { dx, dy } = STAIR_STEP[st.dir];
      const s: Stair = {
        id: stairs.length,
        tx: cx * CHUNK_SIZE + st.tx,
        ty: cy * CHUNK_SIZE + st.ty,
        z,
        dir: st.dir,
        len: st.len,
        dx,
        dy,
      };
      stairs.push(s);
      for (let i = 0; i < s.len; i++) {
        this.stairTiles.set(stairKey(s.tx + dx * i, s.ty + dy * i, s.z), s.id);
      }
    }
  }

  /** Flight covering tile (tx, ty) of its base level `z` (`world/levels.ts` `stairsAt`). */
  /** Map edge kind of a raw edge id (`SimMap.edgeKinds`: wall, fence, gate…), null = unknown. */
  edgeKindOf(edgeId: number): string | null {
    return edgeId > 0 ? (this.map.edgeKinds?.[edgeId] ?? null) : null;
  }

  /** Tree crowns of a chunk on level 0 (`SimChunk.trees`, chunk-local tiles), if any. */
  treesOf(cx: number, cy: number): readonly number[] | undefined {
    return this.chunkAt(cx, cy, 0)?.trees;
  }

  stairAt(tx: number, ty: number, z: number): Stair | undefined {
    if (this.stairs.length === 0) return undefined;
    const i = this.stairTiles.get(stairKey(tx, ty, z));
    return i === undefined ? undefined : this.stairs[i];
  }

  private chunkAt(cx: number, cy: number, z: number): SimChunk | undefined {
    if (cx !== this.lastCx || cy !== this.lastCy || z !== this.lastZ) {
      this.lastCx = cx;
      this.lastCy = cy;
      this.lastZ = z;
      this.lastChunk = this.map.getChunk(cx, cy, z);
      if (this.lastChunk?.wallSegments?.length) this.segmentsSeen = true;
    }
    return this.lastChunk;
  }

  /**
   * Some chunk read so far has `wallSegments` (only a shortcut: on maps without slanted
   * buildings line of sight skips the segment pass; collision reads the chunks it needs anyway).
   */
  segmentsSeen = false;

  /**
   * Exact walls (`SimChunk.wallSegments`, world metres, docs 9.63) of the chunks that touch the
   * box [x0, x1] × [y0, y1] on level z whose bounds touch the box, in chunk (y, x) then list
   * order. `key` is unique per segment (negative, below the blocker keys).
   */
  forSegments(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z: number,
    fn: (key: number, ax: number, ay: number, bx: number, by: number) => void,
  ): void {
    const cx0 = Math.floor(x0 / CHUNK_SIZE);
    const cx1 = Math.floor(x1 / CHUNK_SIZE);
    const cy0 = Math.floor(y0 / CHUNK_SIZE);
    const cy1 = Math.floor(y1 / CHUNK_SIZE);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.chunkAt(cx, cy, z)?.wallSegments;
        if (list === undefined) continue;
        for (let i = 0; i < list.length; i++) {
          const g = list[i]!;
          if (g.z !== z) continue;
          if (Math.max(g.x0, g.x1) < x0 || Math.min(g.x0, g.x1) > x1) continue;
          if (Math.max(g.y0, g.y1) < y0 || Math.min(g.y0, g.y1) > y1) continue;
          fn(
            SEGMENT_KEY_BASE - (((cx + 0x2000) * 0x4000 + (cy + 0x2000)) * 4096 + i),
            g.x0,
            g.y0,
            g.x1,
            g.y1,
          );
        }
      }
    }
  }

  private layer(tx: number, ty: number, z: number, name: 'floor' | 'edgeN' | 'edgeW'): number {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    const chunk = this.chunkAt(cx, cy, z);
    if (!chunk) return -1;
    return chunk[name][(ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE)] ?? -1;
  }

  /**
   * Global building id at a tile (0 = outside / no building). Room ids are chunk-local
   * (`SimChunk.roomBuildings` maps them to buildings), so "same building" compares this value.
   */
  buildingAt(tx: number, ty: number, z: number): number {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    return buildingIdAt(
      this.chunkAt(cx, cy, z),
      (ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE),
    );
  }

  /** Chunk-local room id at a tile (0 = outside), `SimChunk.room`. */
  roomAt(tx: number, ty: number, z: number): number {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    return roomIdAt(
      this.chunkAt(cx, cy, z),
      (ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE),
    );
  }

  /** No floor (id 0) or outside the map. */
  isVoid(tx: number, ty: number, z: number): boolean {
    return this.layer(tx, ty, z, 'floor') <= 0;
  }

  /**
   * A body cannot stand here: no floor, or a tile occupied by furniture (footprint flag on).
   * Use for movement, paths and free spots; `isVoid` stays "no floor" (falling, levels).
   */
  isBlocked(tx: number, ty: number, z: number): boolean {
    return this.isVoid(tx, ty, z) || this.furnitureBlocks(tx, ty, z);
  }

  /**
   * Static blockers (`SimChunk.blockers`, pylon / mast feet) of the chunks that touch the box
   * [x0, x1] × [y0, y1] on level z, as world-tile rectangles, in chunk (y, x) then list order.
   * `key` is unique per blocker (negative, never a tile obstacle key).
   */
  forBlockers(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z: number,
    fn: (key: number, bx0: number, bx1: number, by0: number, by1: number) => void,
  ): void {
    const cx0 = Math.floor(x0 / CHUNK_SIZE);
    const cx1 = Math.floor(x1 / CHUNK_SIZE);
    const cy0 = Math.floor(y0 / CHUNK_SIZE);
    const cy1 = Math.floor(y1 / CHUNK_SIZE);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.chunkAt(cx, cy, z)?.blockers;
        if (list === undefined) continue;
        const ox = cx * CHUNK_SIZE;
        const oy = cy * CHUNK_SIZE;
        for (let i = 0; i < list.length; i++) {
          const b = list[i]!;
          const bx0 = ox + b.x0;
          const bx1 = ox + b.x1;
          const by0 = oy + b.y0;
          const by1 = oy + b.y1;
          if (bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1) continue;
          fn(-1 - (((cx + 0x2000) * 0x4000 + (cy + 0x2000)) * 1024 + i), bx0, bx1, by0, by1);
        }
      }
    }
  }

  /** Furniture occupies the tile (footprint flag on; always false when off). */
  furnitureBlocks(tx: number, ty: number, z: number): boolean {
    return this.furniture !== undefined && (this.furniture.flags(tx, ty, z) & FF.blocks) !== 0;
  }

  /** Tall furniture on the tile blocks sight (footprint flag on). */
  blocksSightTile(tx: number, ty: number, z: number): boolean {
    return this.furniture !== undefined && (this.furniture.flags(tx, ty, z) & FF.tall) !== 0;
  }

  /** Edge blocking movement on the north edge of the tile (segment y = ty, x ∈ [tx, tx+1]). */
  hasWallN(tx: number, ty: number, z: number): boolean {
    return (this.flagsN(tx, ty, z) & EF.blocksMove) !== 0;
  }

  /** Edge blocking movement on the west edge of the tile (segment x = tx, y ∈ [ty, ty+1]). */
  hasWallW(tx: number, ty: number, z: number): boolean {
    return (this.flagsW(tx, ty, z) & EF.blocksMove) !== 0;
  }

  /** Raw edge id on the north / west side (0 = none, -1 = outside the map). */
  edgeN(tx: number, ty: number, z: number): number {
    return this.layer(tx, ty, z, 'edgeN');
  }

  edgeW(tx: number, ty: number, z: number): number {
    return this.layer(tx, ty, z, 'edgeW');
  }

  /** Door / window kind of an edge id (OpeningKind: 0 = wall or none). */
  kindOf(edgeId: number): number {
    return edgeId > 0 ? (this.openings.kinds[edgeId] ?? 0) : 0;
  }

  /** Flags (EF) of the north edge of (tx, ty); outside the map = wall. */
  flagsN(tx: number, ty: number, z: number): number {
    return this.flags(this.layer(tx, ty, z, 'edgeN'), 0, tx, ty, z);
  }

  flagsW(tx: number, ty: number, z: number): number {
    return this.flags(this.layer(tx, ty, z, 'edgeW'), 1, tx, ty, z);
  }

  private flags(id: number, side: number, tx: number, ty: number, z: number): number {
    if (id === 0) return 0;
    if (id < 0) return WALL;
    const kind = this.openings.kinds[id] ?? 0;
    if (kind === 0) return WALL;
    const key = openingKey(side, tx, ty, z);
    const e = this.openings.states.get(key);
    const f = openingFlags(
      kind,
      e?.state ?? baseState(this.openings, key),
      e?.planks ?? 0,
      this.openings.cfg.barricade.sightBlockPlanks,
    );
    // Window cover (docs 9.78): blocks sight only, never movement.
    return coverBlocksSight(this.openings, key) ? f | EF.covered : f;
  }
}
