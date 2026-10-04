import { buildingIdAt, CHUNK_SIZE, type SimChunk, type SimMap } from '@deadzone/protocol';
import {
  createOpeningsWorld,
  DEFAULT_OPENINGS_CONFIG,
  EF,
  openingFlags,
  openingKey,
  OS,
  type OpeningsWorld,
} from '../openings/state.js';
import { STAIR_STEP, type Stair } from './levels.js';

const WALL = EF.present | EF.blocksMove | EF.blocksSight | EF.muffles;

/** Numeric tile key (|tx|, |ty| < 2^20, z in −128..127): no string building on hot paths. */
const stairKey = (tx: number, ty: number, z: number): number =>
  ((tx + 0x100000) * 0x200000 + (ty + 0x100000)) * 256 + (z + 128);

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
    }
    return this.lastChunk;
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

  /** No floor (id 0) or outside the map. */
  isVoid(tx: number, ty: number, z: number): boolean {
    return this.layer(tx, ty, z, 'floor') <= 0;
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
    const e = this.openings.states.get(openingKey(side, tx, ty, z));
    return openingFlags(
      kind,
      e?.state ?? OS.closed,
      e?.planks ?? 0,
      this.openings.cfg.barricade.sightBlockPlanks,
    );
  }
}
