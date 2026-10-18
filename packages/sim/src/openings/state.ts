import {
  CHUNK_SIZE,
  OPENING_STATES,
  tileIndex,
  type EdgeSide,
  type OpeningState,
  type OpeningView,
  type SimEdgeKind,
  type SimChunk,
  type SimMap,
} from '@deadzone/protocol';
import {
  BUILDING_KINDS,
  buildingKindFromRooms,
  exteriorLockedChanceFor,
  type BuildingKind,
  type ContentBundle,
} from '@deadzone/content';
import { deriveSeed, Rng } from '../core/rng.js';
import { FENCE_HP } from '../physics/constants.js';

/** `worldSettings.openings` (defaults = the schema defaults in packages/content). */
export type OpeningsConfig = ContentBundle['worldSettings']['openings'];

export const DEFAULT_OPENINGS_CONFIG: OpeningsConfig = {
  doorHp: 60,
  windowHp: 6,
  gateHp: 80,
  zombieBashMul: 1,
  bashNoise: { radiusTiles: 14, volume: 0.8 },
  breakNoise: { radiusTiles: 20, volume: 1 },
  toggleNoise: { radiusTiles: 3, volume: 0.3 },
  windowSpeedMul: 0.3,
  reachTiles: 1.5,
  barricade: {
    maxPlanks: 4,
    plankHp: 40,
    plankItem: 'base:plank',
    nailsItem: 'base:nails',
    nailsPerPlank: 2,
    hammerTag: 'base:tool-hammer',
    pryTag: 'base:tool-pry',
    addSec: 8,
    removeSec: 5,
    carpentryTimePerLevel: 0.06,
    minTimeMul: 0.4,
    skill: 'base:carpentry',
    xpPerPlank: 3,
    xpPerRemove: 1,
    nailReturnChance: 0.5,
    sightBlockPlanks: 2,
    noise: { radiusTiles: 15, volume: 0.7 },
  },
  window: {
    smashSec: 1.5,
    handCutChance: 0.5,
    removeGlassSec: 6,
    glassItem: 'base:glass-shards',
    glassPieces: 1,
    climbLacerationShare: 0.4,
    clearGlassCutChance: 0.3,
    gloveTag: 'base:gloves',
  },
  force: {
    prySec: 6,
    pryChance: 0.4,
    pryNoise: { radiusTiles: 10, volume: 0.5 },
    kickSec: 4,
    kickChance: 0.15,
    kickNoise: { radiusTiles: 16, volume: 0.8 },
    chancePerStrength: 0.03,
    strengthSkill: 'base:strength',
    failDamage: 8,
  },
  locks: {
    exteriorLockedChance: 0,
    keyTag: 'base:building-key',
    keySec: 2,
    corpseKeyRadiusTiles: 24,
    lockpick: {
      tag: 'base:lockpick',
      sec: 8,
      chance: 0.25,
      chancePerLevel: 0.06,
      skill: 'base:nimble',
      breakChance: 0.35,
      xp: 2,
      noise: { radiusTiles: 2, volume: 0.15 },
    },
    knockNoise: { radiusTiles: 6, volume: 0.4 },
  },
};

/**
 * Edge id kind: 0 = wall (or unknown), 1 = door, 2 = window, 3 = low fence (`closed` = standing,
 * `broken` = knocked over by a crowd, `physics/crowd.ts`), 4 = gate in a fence (states like a
 * door; closed it blocks movement, not sight or sound).
 */
export const OpeningKind = { wall: 0, door: 1, window: 2, fence: 3, gate: 4 } as const;

/** Doors and gates: open / close / lock / force (`toggleDoor lock`, `forceDoor`). */
export const isDoorLike = (kind: number): boolean =>
  kind === OpeningKind.door || kind === OpeningKind.gate;
/** Planks go on doors, windows and gates (not on low fences). */
export const isBarricadable = (kind: number): boolean =>
  kind === OpeningKind.door || kind === OpeningKind.window || kind === OpeningKind.gate;

export const OS = {
  open: OPENING_STATES.indexOf('open'),
  closed: OPENING_STATES.indexOf('closed'),
  locked: OPENING_STATES.indexOf('locked'),
  barricaded: OPENING_STATES.indexOf('barricaded'),
  broken: OPENING_STATES.indexOf('broken'),
} as const;

export interface OpeningEntry {
  kind: number;
  state: number;
  /** Hp of the edge itself (door / pane / gate / fence). */
  hp: number;
  /** Planks nailed over it (0..`barricade.maxPlanks`). */
  planks: number;
  /**
   * Hp of all planks together (f32): the top plank has `bhp − (planks − 1) × plankHp`, so
   * blows knock them off one by one (`planks = ceil(bhp / plankHp)`).
   */
  bhp: number;
  /** Broken window: 1 = the shards were removed (`removeGlass`), 0 otherwise. */
  cleared: number;
}

/** Extra fields of a state change (planks, glass); omitted = keep what the edge has. */
export interface OpeningExtra {
  planks?: number;
  bhp?: number;
  cleared?: number;
}

/**
 * Door / window state (world state: hashed and saved). Only edges that differ from the map
 * default (`closed`, full hp) are stored. Keys: `openingKey(side, tx, ty, z)`, numeric order is
 * the deterministic iteration order (hash, views).
 */
export interface OpeningsWorld {
  readonly cfg: OpeningsConfig;
  /** Edge id → OpeningKind (derived from `SimMap.edgeKinds`). */
  readonly kinds: Uint8Array;
  readonly states: Map<number, OpeningEntry>;
  /** Zombie eid → tick of its next blow at a door / window. */
  readonly bashAt: Map<number, number>;
  /** Bumped on every change (views). */
  version: number;
  /** Map and world seed for the default lock of each door (derived, not saved). */
  readonly map: SimMap;
  readonly seed: number;
  /** Edge key → locked at the start (`baseState`; derived cache, not saved). */
  readonly lockCache: Map<number, boolean>;
  /**
   * Building id → room types of all its rooms (`SimChunk.rooms` gathered by `roomBuildings`),
   * built once on the first lock roll (derived from the map, not saved).
   */
  buildingRooms: Map<number, Set<string>> | undefined;
  /** Windows with drawn curtains (edge keys; saved, docs 9.53). */
  readonly curtains: Set<number>;
  /** Light switches turned on (`switchKeyOf`; saved, docs 9.53). */
  readonly lightsOn: Set<number>;
}

export function createOpeningsWorld(map: SimMap, cfg: OpeningsConfig, seed = 0): OpeningsWorld {
  const edgeKinds = map.edgeKinds ?? [];
  const kinds = new Uint8Array(Math.max(1, edgeKinds.length));
  edgeKinds.forEach((k: SimEdgeKind | null, id) => {
    kinds[id] =
      k === 'door'
        ? OpeningKind.door
        : k === 'window'
          ? OpeningKind.window
          : k === 'fence'
            ? OpeningKind.fence
            : k === 'gate'
              ? OpeningKind.gate
              : 0;
  });
  return {
    cfg,
    kinds,
    states: new Map(),
    bashAt: new Map(),
    version: 0,
    map,
    seed,
    lockCache: new Map(),
    buildingRooms: undefined,
    curtains: new Set(),
    lightsOn: new Set(),
  };
}

const SIDE_N = 0;
const SIDE_W = 1;
export const sideIndex = (side: EdgeSide): number => (side === 'n' ? SIDE_N : SIDE_W);

/** Packs an edge into a safe integer (z: 8 bits, ty / tx: 16 bits, side: 1 bit). */
export const openingKey = (side: number, tx: number, ty: number, z: number): number =>
  (((z + 0x80) * 0x10000 + (ty + 0x8000)) * 0x10000 + (tx + 0x8000)) * 2 + side;

export function unpackKey(key: number): { side: EdgeSide; tx: number; ty: number; z: number } {
  const side = key % 2;
  let k = (key - side) / 2;
  const tx = (k % 0x10000) - 0x8000;
  k = (k - (tx + 0x8000)) / 0x10000;
  const ty = (k % 0x10000) - 0x8000;
  const z = (k - (ty + 0x8000)) / 0x10000 - 0x80;
  return { side: side === SIDE_N ? 'n' : 'w', tx, ty, z };
}

/** Max hp of the edge itself in a state (planks not included; broken = 0). */
export function maxHp(cfg: OpeningsConfig, kind: number, state: number): number {
  if (state === OS.broken) return 0;
  if (kind === OpeningKind.fence) return FENCE_HP;
  if (kind === OpeningKind.gate) return cfg.gateHp;
  return kind === OpeningKind.door ? cfg.doorHp : cfg.windowHp;
}

/** Hp of the top plank (0 without planks). */
export function topPlankHp(cfg: OpeningsConfig, e: OpeningEntry | undefined): number {
  if (!e || e.planks <= 0) return 0;
  return Math.max(0, e.bhp - (e.planks - 1) * cfg.barricade.plankHp);
}

export function stateOf(o: OpeningsWorld, key: number): OpeningEntry | undefined {
  return o.states.get(key);
}

/** Edge flag bits (TileGrid.edgeFlags*). */
export const EF = {
  present: 1,
  blocksMove: 2,
  blocksSight: 4,
  /** Counts as a wall for sound (attenuation). */
  muffles: 8,
  /** Door / window: zombies path through it (they bash it when closed). */
  opening: 16,
  /** Open / broken window: passable, but slows movement. */
  slow: 32,
} as const;

/**
 * Flags of a door / window / fence / gate edge in a given state with `planks` nailed over it
 * (`sightPlanks` = `barricade.sightBlockPlanks`).
 */
export function openingFlags(kind: number, state: number, planks = 0, sightPlanks = 1): number {
  let f = EF.present | EF.opening;
  const passable = state === OS.open || state === OS.broken;
  // Low fence: blocks movement while standing (not sight or sound); knocked over = slow.
  if (kind === OpeningKind.fence) return f | (passable ? EF.slow : EF.blocksMove);
  // Legacy state `barricaded` (old saves): as fully planked.
  if (state === OS.barricaded) planks = Math.max(planks, sightPlanks);
  if (planks > 0) {
    f |= EF.blocksMove | EF.muffles;
    if (kind === OpeningKind.door || planks >= sightPlanks) f |= EF.blocksSight;
    return f;
  }
  if (kind === OpeningKind.gate) return passable ? f : f | EF.blocksMove;
  if (!passable) f |= EF.blocksMove | EF.muffles;
  if (kind === OpeningKind.door) {
    if (!passable) f |= EF.blocksSight;
  } else if (passable) f |= EF.slow;
  return f;
}

/**
 * Sets a state (hp = the state's max unless given; planks / glass kept unless given). The
 * default (closed, full hp, no planks) is not stored.
 */
export function setOpening(
  o: OpeningsWorld,
  key: number,
  kind: number,
  state: number,
  hp = maxHp(o.cfg, kind, state),
  extra: OpeningExtra = {},
): void {
  const prev = o.states.get(key);
  const planks = extra.planks ?? prev?.planks ?? 0;
  const bhp = planks > 0 ? (extra.bhp ?? prev?.bhp ?? 0) : 0;
  const cleared = state === OS.broken ? (extra.cleared ?? prev?.cleared ?? 0) : 0;
  if (state === baseState(o, key) && hp >= maxHp(o.cfg, kind, state) && planks === 0)
    o.states.delete(key);
  else
    o.states.set(key, {
      kind,
      state,
      hp: Math.fround(hp),
      planks,
      bhp: Math.fround(bhp),
      cleared,
    });
  o.version++;
}

const KIND_NAMES = ['window', 'door', 'window', 'fence', 'gate'] as const;

export function openingView(o: OpeningsWorld, key: number, kind: number): OpeningView {
  const e = o.states.get(key);
  if (e) kind = e.kind;
  const state = e?.state ?? baseState(o, key);
  const { side, tx, ty, z } = unpackKey(key);
  const planks = e?.planks ?? 0;
  const edgeHp = e?.hp ?? maxHp(o.cfg, kind, state);
  return {
    tx,
    ty,
    z,
    side,
    kind: KIND_NAMES[kind] ?? 'window',
    state: OPENING_STATES[state] as OpeningState,
    hp: Math.round((edgeHp + (planks > 0 ? (e?.bhp ?? 0) : 0)) * 10) / 10,
    maxHp: maxHp(o.cfg, kind, state) + planks * o.cfg.barricade.plankHp,
    barricade: planks,
    glass: kind === OpeningKind.window && !(state === OS.broken && e?.cleared),
    ...(o.curtains.has(key) ? { curtains: true } : {}),
  };
}

/** Kind of the edge `key` from the map (0 = wall / unknown / chunk not loaded). */
export function edgeKindOf(o: OpeningsWorld, key: number): number {
  const k = unpackKey(key);
  const cx = Math.floor(k.tx / CHUNK_SIZE);
  const cy = Math.floor(k.ty / CHUNK_SIZE);
  const chunk = o.map.getChunk(cx, cy, k.z);
  if (!chunk) return 0;
  const i = tileIndex(k.tx - cx * CHUNK_SIZE, k.ty - cy * CHUNK_SIZE);
  const id = (k.side === 'n' ? chunk.edgeN : chunk.edgeW)[i] ?? 0;
  return id > 0 ? (o.kinds[id] ?? 0) : 0;
}

/** Room id of tile (x, y, z) and its building (0 = outside / unknown); undefined = not loaded. */
export function roomAt(
  map: SimMap,
  x: number,
  y: number,
  z: number,
): { room: number; building: number } | undefined {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const chunk = map.getChunk(cx, cy, z);
  if (!chunk) return undefined;
  const room = chunk.room?.[tileIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE)] ?? 0;
  const building = room ? (chunk.roomBuildings?.[String(room)] ?? 0) : 0;
  return { room, building };
}

/** The two tiles an edge separates: north edge (tx, ty−1 | tx, ty), west edge (tx−1, ty | tx, ty). */
export function edgeTiles(key: number): [{ x: number; y: number }, { x: number; y: number }] {
  const k = unpackKey(key);
  return k.side === 'n'
    ? [
        { x: k.tx, y: k.ty - 1 },
        { x: k.tx, y: k.ty },
      ]
    : [
        { x: k.tx - 1, y: k.ty },
        { x: k.tx, y: k.ty },
      ];
}

/** Room types per building id over the whole map (`listChunks`), sorted chunk order. */
function buildingRoomsOf(o: OpeningsWorld): Map<number, Set<string>> {
  if (o.buildingRooms) return o.buildingRooms;
  const out = new Map<number, Set<string>>();
  for (const a of o.map.listChunks?.() ?? []) addChunkRooms(out, o.map.getChunk(a.cx, a.cy, a.z));
  o.buildingRooms = out;
  return out;
}

function addChunkRooms(out: Map<number, Set<string>>, chunk: SimChunk | undefined): void {
  if (!chunk?.roomBuildings || !chunk.rooms) return;
  for (const [room, building] of Object.entries(chunk.roomBuildings)) {
    const type = chunk.rooms[room];
    if (!type || !building) continue;
    let set = out.get(building);
    if (!set) out.set(building, (set = new Set()));
    set.add(type);
  }
}

/**
 * Room types of the building behind an exterior door: every room with the same `roomBuildings`
 * id (whole map when it can list chunks, else the 3 × 3 chunks around the door on its level
 * `z`); a room with no building id counts alone.
 */
function buildingRoomTypes(o: OpeningsWorld, x: number, y: number, z: number): string[] {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const chunk = o.map.getChunk(cx, cy, z);
  const room = chunk?.room?.[tileIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE)] ?? 0;
  if (!chunk || !room) return [];
  const building = chunk.roomBuildings?.[String(room)] ?? 0;
  const own = chunk.rooms?.[String(room)];
  if (!building) return own ? [own] : [];
  if (o.map.listChunks) return [...(buildingRoomsOf(o).get(building) ?? [])];
  const near = new Map<number, Set<string>>();
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) addChunkRooms(near, o.map.getChunk(cx + dx, cy + dy, z));
  return [...(near.get(building) ?? [])];
}

/**
 * Generator kinds without their own lock chance (`building-kind.ts` in content): what they lock
 * like. Kinds of `BUILDING_KINDS` map to themselves.
 */
const KIND_ALIASES: Readonly<Record<string, BuildingKind | undefined>> = {
  block: 'house',
  kostka: 'house',
  station: 'shop',
  'fire-station': 'office',
  shed: 'garage',
};
const KNOWN_KINDS: ReadonlySet<string> = new Set(BUILDING_KINDS);

/** Lock kind of a generator `buildingKind` (#249); `undefined` = unknown (fall back to rooms). */
export function lockKindOf(kind: string | undefined): BuildingKind | undefined {
  if (kind === undefined) return undefined;
  return KNOWN_KINDS.has(kind) ? (kind as BuildingKind) : KIND_ALIASES[kind];
}

/**
 * Kind of the building behind an exterior door from `SimChunk.buildingKinds` (#249): the chunk of
 * the inside tile, else the 3 × 3 chunks around it (a building's kind sits in the chunks holding
 * its rooms). `undefined` without a building id or a known kind.
 */
function chunkBuildingKind(
  o: OpeningsWorld,
  x: number,
  y: number,
  z: number,
): BuildingKind | undefined {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const building = roomAt(o.map, x, y, z)?.building ?? 0;
  if (!building) return undefined;
  const id = String(building);
  const own = lockKindOf(o.map.getChunk(cx, cy, z)?.buildingKinds?.[id]);
  if (own) return own;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const k = lockKindOf(o.map.getChunk(cx + dx, cy + dy, z)?.buildingKinds?.[id]);
      if (k) return k;
    }
  return undefined;
}

/**
 * Door / gate locked at the start: `SimChunk.lockedDoors` when the generator gave it (always
 * wins), else rolled from the world seed per edge with `exteriorLockedChanceFor(locks, kind)`:
 * an exterior door (a room on one side, outside on the other) by the kind of its building
 * (`SimChunk.buildingKinds` from the generator, #249, via `lockKindOf`; else
 * `buildingKindFromRooms` over the building's room types), a gate as `gate`. Cached; not saved
 * (derived from map + seed).
 */
export function lockedAtStart(o: OpeningsWorld, key: number): boolean {
  const hit = o.lockCache.get(key);
  if (hit !== undefined) return hit;
  const k = unpackKey(key);
  const cx = Math.floor(k.tx / CHUNK_SIZE);
  const cy = Math.floor(k.ty / CHUNK_SIZE);
  const chunk = o.map.getChunk(cx, cy, k.z);
  if (!chunk) return false;
  let locked = false;
  const kind = edgeKindOf(o, key);
  const locks = o.cfg.locks;
  if (kind === OpeningKind.door || kind === OpeningKind.gate) {
    if (chunk.lockedDoors) {
      const code = tileIndex(k.tx - cx * CHUNK_SIZE, k.ty - cy * CHUNK_SIZE) * 2 + (key % 2);
      locked = chunk.lockedDoors.includes(code);
    } else if (locks) {
      const [a, b] = edgeTiles(key);
      const ra = roomAt(o.map, a.x, a.y, k.z);
      const rb = roomAt(o.map, b.x, b.y, k.z);
      if (!ra || !rb) return false;
      let chance = 0;
      if (kind === OpeningKind.gate) chance = exteriorLockedChanceFor(locks, 'gate');
      else if ((ra.room === 0) !== (rb.room === 0)) {
        const t = ra.room ? a : b;
        chance = exteriorLockedChanceFor(
          locks,
          chunkBuildingKind(o, t.x, t.y, k.z) ??
            buildingKindFromRooms(buildingRoomTypes(o, t.x, t.y, k.z)),
        );
      }
      if (chance > 0) {
        const roll = Rng.fromSeed(deriveSeed(o.seed, 'door-lock', k.tx, k.ty, k.z, key % 2));
        locked = roll.nextFloat() < chance;
      }
    }
  }
  o.lockCache.set(key, locked);
  return locked;
}

/** State of an edge with no stored entry: `locked` for doors locked at the start, else `closed`. */
export const baseState = (o: OpeningsWorld, key: number): number =>
  lockedAtStart(o, key) ? OS.locked : OS.closed;

/** Current state of an edge (stored entry, else `baseState`). */
export const currentState = (o: OpeningsWorld, key: number): number =>
  o.states.get(key)?.state ?? baseState(o, key);
