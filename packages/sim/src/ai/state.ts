import {
  CHUNK_SIZE,
  NOISE_SOURCES,
  type NoiseSource,
  type SimMap,
  type SimZone,
} from '@deadzone/protocol';
import type { ContentIndex, ZombieTypeDef } from '../content/adapter.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { SpatialHash } from '../core/spatial.js';
import { createCombatWorld, type CombatWorld } from '../combat/state.js';
import { DEFAULT_COMBAT_CONFIG } from '../combat/config.js';
import type { CombatConfig } from '../combat/config.js';
import { DEFAULT_STAGE4_CONFIG, type Stage4Config } from './config.js';

/** Zombie FSM (docs 2.5 `ai`). Values are stored in `Zombie.state` and hashed. */
export const ZombieState = {
  idle: 0,
  wander: 1,
  investigate: 2,
  chase: 3,
  /** Lost the target: looks around the last known position, then wanders. */
  search: 4,
} as const;
export type ZombieStateValue = (typeof ZombieState)[keyof typeof ZombieState];
export const ZOMBIE_STATE_NAMES = ['idle', 'wander', 'investigate', 'chase', 'search'] as const;
export type ZombieStateName = (typeof ZOMBIE_STATE_NAMES)[number];

export const noiseSourceIndex = (s: NoiseSource): number => NOISE_SOURCES.indexOf(s);

/** One noise (docs 2.5 `noise`): kept for `farThinkEveryTicks`, so every zombie hears it once. */
export interface Noise {
  tick: number;
  x: number;
  y: number;
  /** Floor index of the source (`Math.floor` of the emitter's z). */
  z: number;
  radius: number;
  volume: number;
  source: number;
  /** Real seconds zombies linger at it (lures), 0 = `ai.investigateLingerSec`. */
  lingerSec: number;
}

/** A zombie type with speeds in tiles per tick (f32). */
export interface CompiledZombieType {
  def: ZombieTypeDef;
  wanderPerTick: number;
  chasePerTick: number;
}

/** A static light (map object whose definition has a `light` block). */
export interface StaticLight {
  x: number;
  y: number;
  z: number;
  radius: number;
  intensity: number;
  requiresPower: boolean;
}

/** Cached A* result: tile centres to walk through (x, y pairs). Derived, rebuilt on demand. */
export interface Path {
  goalTx: number;
  goalTy: number;
  tiles: Int32Array;
  len: number;
  cursor: number;
  /** Tick of the request (FIFO order for the budget). */
  requestedTick: number;
  status: 'pending' | 'ready' | 'failed';
}

/** Flow field around a player: Dijkstra distances (10 / 14 per step) in a square window. */
export interface FlowField {
  ox: number;
  oy: number;
  z: number;
  size: number;
  dist: Uint16Array;
  targetTx: number;
  targetTy: number;
  builtTick: number;
}

export const FLOW_UNREACHABLE = 0xffff;

/** Per-player threat, recomputed every tick by `ai.threat` (derived). */
export interface Threat {
  chasing: number;
  near: number;
}

export interface AiWorld {
  readonly cfg: Stage4Config;
  readonly types: CompiledZombieType[];
  /** Integer spawn weights (`spawnWeight` × 1000), index = type. */
  readonly spawnWeights: number[];
  readonly lights: StaticLight[];
  readonly darkZones: SimZone[];
  /** Noises of the last `farThinkEveryTicks` ticks, in emission order (state, hashed). */
  noises: Noise[];
  readonly spatial: SpatialHash;
  /** Zombie eid → cached path (derived: rebuilt after a load). */
  readonly paths: Map<number, Path>;
  /** Pending A* requests (zombie eids, FIFO by request tick then StableId). */
  pathQueue: number[];
  /** Player eid → flow field (derived). */
  readonly flows: Map<number, FlowField>;
  /** Player eid → threat (derived). */
  readonly threat: Map<number, Threat>;
  /** Player eid → visibility factor for zombie sight this tick (derived). */
  readonly visibility: Map<number, number>;
  /** Per zombie eid (derived): straight line to the goal is walkable (checked when thinking). */
  readonly direct: Uint8Array;
  /** Per zombie eid: position before the last movement (progress check for `stuck`). */
  readonly lastX: Float32Array;
  readonly lastY: Float32Array;
  zombieCount: number;
  /** Melee combat (Stage 4, `combat/*`). */
  readonly combat: CombatWorld;
}

export function createAiWorld(
  content: ContentIndex,
  map: SimMap,
  capacity: number,
  cfg: Stage4Config = DEFAULT_STAGE4_CONFIG,
  combatCfg?: CombatConfig,
): AiWorld {
  const perTick = (v: number): number => Math.fround(v / TICKS_PER_SECOND);
  const v = content.vision;
  // Data wins over the module defaults (worldSettings.vision).
  if (v)
    cfg = {
      ...cfg,
      vision: {
        ...cfg.vision,
        playerSightTiles: v.dayRangeTiles,
        nightFactor: v.nightFactor,
        lightBonus: v.lightBonus,
        enabled: v.enabled,
      },
    };
  const n = content.noise;
  if (n) cfg = { ...cfg, noise: { ...cfg.noise, floorMul: n.floorMul, maxFloors: n.maxFloors } };
  return {
    cfg,
    types: content.zombieTypes.map((def) => ({
      def,
      wanderPerTick: perTick(def.speed.wanderTilesPerSec),
      chasePerTick: perTick(def.speed.chaseTilesPerSec),
    })),
    spawnWeights: content.zombieTypes.map((t) => Math.round((t.spawnWeight ?? 1) * 1000)),
    lights: collectLights(content, map),
    darkZones: (map.zones ?? []).filter((zn) => zn.role === 'dark'),
    noises: [],
    spatial: new SpatialHash(),
    paths: new Map(),
    pathQueue: [],
    flows: new Map(),
    threat: new Map(),
    visibility: new Map(),
    direct: new Uint8Array(capacity),
    lastX: new Float32Array(capacity),
    lastY: new Float32Array(capacity),
    zombieCount: 0,
    combat: createCombatWorld(
      capacity,
      content.firearms
        ? { ...(combatCfg ?? DEFAULT_COMBAT_CONFIG), firearms: content.firearms }
        : combatCfg,
    ),
  };
}

/** Lights of map objects: placeables with `placeable.light` (chunk order z, cy, cx). */
function collectLights(content: ContentIndex, map: SimMap): StaticLight[] {
  const out: StaticLight[] = [];
  const list = [...(map.listChunks?.() ?? [])].sort(
    (a, b) => a.z - b.z || a.cy - b.cy || a.cx - b.cx,
  );
  for (const addr of list) {
    for (const obj of map.getChunk(addr.cx, addr.cy, addr.z)?.objects ?? []) {
      const i = content.itemIndex.get(obj.contentId);
      const def = i === undefined ? undefined : content.items[i];
      if (def?.kind !== 'placeable' || !def.placeable.light) continue;
      const l = def.placeable.light;
      out.push({
        x: addr.cx * CHUNK_SIZE + obj.x + 0.5,
        y: addr.cy * CHUNK_SIZE + obj.y + 0.5,
        z: addr.z,
        radius: l.radiusTiles,
        intensity: l.intensity,
        requiresPower: l.requiresPower,
      });
    }
  }
  return out;
}
