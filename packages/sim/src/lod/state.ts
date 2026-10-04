import {
  worldHeightChunks,
  worldWidthChunks,
  type WorldBounds,
  type WorldSource,
} from '@deadzone/protocol';
import type { ContentIndex } from '../content/adapter.js';
import { deriveSeed, Rng } from '../core/rng.js';

/** `worldSettings.simLod` (content schema `sim-lod-settings.ts`). */
export type SimLodConfig = NonNullable<ContentIndex['simLod']>;

/** Module defaults (same as the content schema), for content without `simLod`. */
export const DEFAULT_SIM_LOD: SimLodConfig = {
  enabled: true,
  activeRadiusChunks: 3,
  hysteresisChunks: 1,
  cellSizeChunks: 1,
  coarseTickEvery: 100,
  maxActiveZombies: 300,
  maxSpawnPerTick: 16,
  minSpawnDistTiles: 24,
  keepDamagedPerCell: 32,
  drift: { chance: 0.05, fraction: 0.25 },
  noise: { minRadiusTiles: 40, radiusMul: 4, memorySec: 60, pullFraction: 0.5 },
  zombiesPerChunk: {
    centrum: 4,
    uslugi: 3,
    bloki: 4,
    domy: 2,
    przemysl: 1.5,
    wojsko: 3,
    ruiny: 1,
    wies: 0.8,
    farma: 0.4,
    pola: 0.05,
    las: 0.03,
    woda: 0,
  },
  defaultZombiesPerChunk: 0.1,
};

/** Loot state of a chunk column (`LodWorld.chunkLoot`). */
export const ChunkLoot = {
  /** Not generated (far away, or unspawned again while unchanged). */
  none: 0,
  /** Generated, unchanged so far (signature in `chunkSig`): unspawned when left. */
  live: 1,
  /** Differs from the generated state: kept forever (part of the save delta). */
  dirty: 2,
} as const;

/**
 * Sim LOD (docs 9.24). Zombies far from every player are counters per cell (`counts`, by type),
 * near players they are entities; world storage and floor loot exist only in chunks a player came
 * close to. Everything here is state (saved and hashed) except `cfg`, `source` and the derived
 * lists (`activeCells`, `liveChunks`, `playerKey`), rebuilt after a load.
 */
export interface LodWorld {
  readonly cfg: SimLodConfig;
  readonly source: WorldSource;
  readonly bounds: WorldBounds;
  readonly wChunks: number;
  readonly hChunks: number;
  readonly cellsW: number;
  readonly cellsH: number;
  /** Zombie types (content order). */
  readonly types: number;
  /** Coarse / pending zombies: `counts[cell * types + type]`. */
  readonly counts: Uint16Array;
  /** 1 = cell simulated in detail (its counter = zombies still waiting to be spawned). */
  readonly active: Uint8Array;
  /** Activations so far per cell (seeds the per-cell spawn RNG). */
  readonly epoch: Uint16Array;
  /** Per chunk column (`ChunkLoot`). */
  readonly chunkLoot: Uint8Array;
  /** Live chunk → signature of its generated storage and items. */
  readonly chunkSig: Map<number, number>;
  /** Active cell → spawn RNG (`deriveSeed(world seed, 'lod-cell', cell, epoch)`). */
  readonly cellRng: Map<number, Rng>;
  /** Cell → `[type, hp, …]` of damaged zombies folded into it (spawned first, with that hp). */
  readonly damaged: Map<number, number[]>;
  /** Cell → `[x, y, z, volume, untilTick]`: zombies pulled in by a noise go investigate it. */
  readonly lures: Map<number, number[]>;
  /** Loud noises acting on coarse cells: `[x, y, coarseRadiusTiles, volume, tick]`. */
  noises: number[][];
  /**
   * Chunks `(z − z0) × columns + column` whose stairs are registered in the tile grid, in
   * registration order (stair ids depend on it; saved and replayed after a load).
   */
  readonly stairChunks: number[];
  /** Derived: `stairChunks` as a set. */
  readonly stairSet: Set<number>;
  /** Next cell of the coarse sweep. */
  cursor: number;
  /** Drift and noise pulls (own stream: world streams and goldens are untouched). */
  rng: Rng;
  /** Derived: active cells, ascending. */
  activeCells: number[];
  /** Derived: chunks with `ChunkLoot.live`, ascending. */
  liveChunks: number[];
  /** Derived: player chunk positions at the last area update ('' = recompute). */
  playerKey: string;
  /** Spawn floor loot / scattered loot in new chunks (sim option `floorLoot`; not state). */
  readonly floorLoot: boolean;
}

export function createLodWorld(
  cfg: SimLodConfig,
  source: WorldSource,
  content: ContentIndex,
  floorLoot: boolean,
): LodWorld {
  const b = source.bounds;
  const wChunks = worldWidthChunks(b);
  const hChunks = worldHeightChunks(b);
  const s = cfg.cellSizeChunks;
  const cellsW = Math.ceil(wChunks / s);
  const cellsH = Math.ceil(hChunks / s);
  const cells = cellsW * cellsH;
  const types = Math.max(1, content.zombieTypes.length);
  return {
    cfg,
    source,
    bounds: b,
    wChunks,
    hChunks,
    cellsW,
    cellsH,
    types,
    counts: new Uint16Array(cells * types),
    active: new Uint8Array(cells),
    epoch: new Uint16Array(cells),
    chunkLoot: new Uint8Array(wChunks * hChunks),
    chunkSig: new Map(),
    cellRng: new Map(),
    damaged: new Map(),
    lures: new Map(),
    noises: [],
    stairChunks: [],
    stairSet: new Set(),
    cursor: 0,
    rng: Rng.fromSeed(deriveSeed(source.seed, 'lod')),
    activeCells: [],
    liveChunks: [],
    playerKey: '',
    floorLoot,
  };
}

/**
 * LOD runs only when the world is bigger than the window a player keeps active: on the small
 * demo maps everything is always detailed (behaviour and golden hashes unchanged).
 */
export function lodApplies(cfg: SimLodConfig, b: WorldBounds): boolean {
  if (!cfg.enabled) return false;
  const win = 2 * (cfg.activeRadiusChunks + cfg.hysteresisChunks) + 1;
  return worldWidthChunks(b) > win || worldHeightChunks(b) > win;
}

/** Cell of a chunk column (clamped into the world). */
export function cellOfChunk(lod: LodWorld, cx: number, cy: number): number {
  const s = lod.cfg.cellSizeChunks;
  const x = Math.min(lod.wChunks - 1, Math.max(0, cx - lod.bounds.cx0));
  const y = Math.min(lod.hChunks - 1, Math.max(0, cy - lod.bounds.cy0));
  return Math.floor(y / s) * lod.cellsW + Math.floor(x / s);
}

/** Chunk column index (no clamping; caller checks bounds). */
export const chunkIndex = (lod: LodWorld, cx: number, cy: number): number =>
  (cy - lod.bounds.cy0) * lod.wChunks + (cx - lod.bounds.cx0);

/** Total coarse / pending zombies of a cell. */
export function cellTotal(lod: LodWorld, cell: number): number {
  let n = 0;
  const o = cell * lod.types;
  for (let t = 0; t < lod.types; t++) n += lod.counts[o + t] ?? 0;
  return n;
}

/** Adds coarse zombies of a type to the cell holding chunk (cx, cy) (tests, game modes). */
export function addCoarseZombies(
  lod: LodWorld,
  cx: number,
  cy: number,
  type: number,
  n: number,
): void {
  const i = cellOfChunk(lod, cx, cy) * lod.types + Math.min(lod.types - 1, Math.max(0, type));
  lod.counts[i] = Math.min(0xffff, (lod.counts[i] ?? 0) + n);
}

/** All coarse / pending zombies. */
export function coarseTotal(lod: LodWorld): number {
  let n = 0;
  for (let i = 0; i < lod.counts.length; i++) n += lod.counts[i]!;
  return n;
}

/** Rebuilds the derived lists after a load. */
export function rebuildLodDerived(lod: LodWorld): void {
  lod.activeCells = [];
  for (let c = 0; c < lod.active.length; c++) if (lod.active[c]) lod.activeCells.push(c);
  lod.liveChunks = [];
  for (let i = 0; i < lod.chunkLoot.length; i++)
    if (lod.chunkLoot[i] === ChunkLoot.live) lod.liveChunks.push(i);
  lod.playerKey = '';
  lod.stairSet.clear();
  for (const k of lod.stairChunks) lod.stairSet.add(k);
}

/** Registers the stairs of every chunk level of column `i` not registered yet (tile grid). */
export function registerStairs(
  lod: LodWorld,
  grid: { addChunkStairs(cx: number, cy: number, z: number): void },
  i: number,
): void {
  const cols = lod.wChunks * lod.hChunks;
  const cx = lod.bounds.cx0 + (i % lod.wChunks);
  const cy = lod.bounds.cy0 + Math.floor(i / lod.wChunks);
  for (let z = lod.bounds.z0; z <= lod.bounds.z1; z++) {
    const k = (z - lod.bounds.z0) * cols + i;
    if (lod.stairSet.has(k)) continue;
    lod.stairSet.add(k);
    lod.stairChunks.push(k);
    grid.addChunkStairs(cx, cy, z);
  }
}

/** After a load: registers the saved stair chunks again, in the saved order. */
export function replayStairs(
  lod: LodWorld,
  grid: { addChunkStairs(cx: number, cy: number, z: number): void },
): void {
  const cols = lod.wChunks * lod.hChunks;
  for (const k of lod.stairChunks) {
    const i = k % cols;
    grid.addChunkStairs(
      lod.bounds.cx0 + (i % lod.wChunks),
      lod.bounds.cy0 + Math.floor(i / lod.wChunks),
      lod.bounds.z0 + Math.floor(k / cols),
    );
  }
}

/**
 * Start population (new game): per cell the summed `zombiesPerChunk` of its chunks' kinds, the
 * fraction rounded by a per-cell RNG, types by `spawnWeight`. Pure function of the world seed.
 */
export function populateLod(lod: LodWorld, spawnWeights: readonly number[]): void {
  const cfg = lod.cfg;
  const src = lod.source;
  const s = cfg.cellSizeChunks;
  const { cx0, cy0, cx1, cy1 } = lod.bounds;
  for (let cyc = 0; cyc < lod.cellsH; cyc++) {
    for (let cxc = 0; cxc < lod.cellsW; cxc++) {
      let e = 0;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const cx = cx0 + cxc * s + dx;
          const cy = cy0 + cyc * s + dy;
          if (cx > cx1 || cy > cy1) continue;
          const kind = src.chunkKind?.(cx, cy);
          e +=
            (kind !== undefined ? cfg.zombiesPerChunk[kind] : undefined) ??
            cfg.defaultZombiesPerChunk;
        }
      }
      if (e <= 0) continue;
      const cell = cyc * lod.cellsW + cxc;
      const rng = Rng.fromSeed(deriveSeed(src.seed, 'lod-pop', cell));
      const whole = Math.floor(e);
      const n = whole + (rng.nextFloat() < e - whole ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const t = spawnWeights.length > 1 ? Math.max(0, rng.pickWeighted(spawnWeights)) : 0;
        const i = cell * lod.types + Math.min(lod.types - 1, t);
        if ((lod.counts[i] ?? 0) < 0xffff) lod.counts[i] = (lod.counts[i] ?? 0) + 1;
      }
    }
  }
}
