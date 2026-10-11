import {
  CHUNK_SIZE,
  MAP_MARKER_ICONS,
  MAX_MAP_ROOMS,
  MAX_ZOMBIE_SIGHTINGS,
  ROOM_INTEL_STATES,
  type RoomIntelState,
  type RoomIntelView,
  type ZombieSightingView,
  MARKER_COLORS,
  type Command,
  type CommandRejectReason,
  type MapMarkerView,
  type MarkerColor,
  type WorldMapView,
  MAP_MARKER_TEXT_MAX,
  MAX_MAP_MARKERS,
  PLAYER_MAP_TRAIL_MAX_POINTS,
  PLAYER_MAP_TRAIL_SPACING_M,
} from '@deadzone/protocol';
import { TICKS_PER_SECOND } from '../core/constants.js';
import type { SimWorld } from '../core/world.js';
import { playerSightRange } from '../ai/vision.js';
import { fromBase64, toBase64 } from '../save/codec.js';
import { decodeZeroRle, encodeZeroRle } from '../save/delta.js';
import { tileKey, type ItemContainer } from '../items/store.js';
import { lineOfSight } from '../world/los.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ } from '../world/levels.js';
import { sortedQuery } from '../core/world.js';

/**
 * The character's world map (docs/sim-architecture.md 9.29): fog of war (one bit per chunk of
 * the world source's bounds), the trail (a point every `trailSpacingM`) and markers. Per
 * character (key = the player's StableId), saved; reset by a new character. Not in the state
 * hash: it never feeds back into the simulation (markers even change outside ticks, in pause).
 */
export interface PlayerMapConfig {
  icons: readonly string[];
  colors: readonly MarkerColor[];
  maxMarkers: number;
  maxTextLength: number;
  discoverEveryTicks: number;
  trailSpacingM: number;
  trailMaxPoints: number;
  /** Sensing of zombies (`sensedZombies`) every this many ticks. */
  senseEveryTicks: number;
  /** Zombies this close (tiles, ±1 floor) are heard through walls. */
  hearTiles: number;
  maxSightings: number;
}

export const DEFAULT_PLAYER_MAP: PlayerMapConfig = {
  icons: MAP_MARKER_ICONS,
  colors: MARKER_COLORS,
  maxMarkers: MAX_MAP_MARKERS,
  maxTextLength: MAP_MARKER_TEXT_MAX,
  discoverEveryTicks: TICKS_PER_SECOND,
  trailSpacingM: PLAYER_MAP_TRAIL_SPACING_M,
  trailMaxPoints: PLAYER_MAP_TRAIL_MAX_POINTS,
  senseEveryTicks: 5,
  hearTiles: 6,
  maxSightings: MAX_ZOMBIE_SIGHTINGS,
};

/** Room sight is tested up to this many tiles (cost bound; sight range is usually below). */
const ROOM_SIGHT_MAX_TILES = 30;

/** Sight range without the AI module (no content): daylight player sight. */
const DEFAULT_SIGHT_TILES = 30;

export interface PlayerMap {
  /** Discovered chunks, bit i = (cy − cy0) × width + (cx − cx0). */
  readonly bits: Uint8Array;
  /** Trail points [x0, y0, x1, y1, …] in whole metres, oldest first. */
  trail: number[];
  readonly markers: Map<number, MapMarkerView>;
  nextId: number;
  /** Floor plan (9.42): rooms the character knows, key `roomKey`. */
  readonly rooms: Map<string, MapRoom>;
  /** Zombies sensed now (StableIds, ascending; derived, not saved). */
  sensed: number[];
  /** Last observation per zombie StableId (not saved). */
  readonly sightings: Map<number, ZombieSightingView>;
  // View sync (derived, not saved): what the next `worldMap` patch must carry.
  sendAll: boolean;
  trailSent: number;
  markersDirty: boolean;
  /** Rooms changed since the last view (`roomsAdd`). */
  readonly roomsAdd: Set<string>;
  sensedDirty: boolean;
  sightingsDirty: boolean;
}

/** A known room (chunk-local id, so the chunk is part of its identity). */
export interface MapRoom {
  readonly cx: number;
  readonly cy: number;
  readonly z: number;
  readonly room: number;
  state: RoomIntelState;
}

export const roomKey = (cx: number, cy: number, z: number, roomId: number): string =>
  `${cx},${cy},${z},${roomId}`;

export interface PlayerMapWorld {
  readonly cfg: PlayerMapConfig;
  readonly cx0: number;
  readonly cy0: number;
  readonly width: number;
  readonly height: number;
  /** Floors of the world (marker `z` range). */
  readonly z0: number;
  readonly z1: number;
  readonly maps: Map<number, PlayerMap>;
}

export function createPlayerMapWorld(w: SimWorld, cfg: PlayerMapConfig): PlayerMapWorld {
  const b = w.source.bounds;
  return {
    cfg,
    cx0: b.cx0,
    cy0: b.cy0,
    width: b.cx1 - b.cx0 + 1,
    height: b.cy1 - b.cy0 + 1,
    z0: Math.min(0, b.z0),
    z1: Math.max(0, b.z1),
    maps: new Map(),
  };
}

function newMap(pm: PlayerMapWorld): PlayerMap {
  return {
    bits: new Uint8Array(Math.ceil((pm.width * pm.height) / 8)),
    trail: [],
    markers: new Map(),
    nextId: 1,
    rooms: new Map(),
    sensed: [],
    sightings: new Map(),
    sendAll: true,
    trailSent: 0,
    markersDirty: false,
    roomsAdd: new Set(),
    sensedDirty: true,
    sightingsDirty: false,
  };
}

/** Map of character `sid` (created empty on first use). */
export function playerMapOf(pm: PlayerMapWorld, sid: number): PlayerMap {
  let m = pm.maps.get(sid);
  if (!m) pm.maps.set(sid, (m = newMap(pm)));
  return m;
}

/** A new character starts with an empty map (fog, trail, markers). */
export function resetPlayerMap(w: SimWorld, sid: number): void {
  const pm = w.playerMap;
  if (!pm) return;
  pm.maps.set(sid, newMap(pm));
}

/** Marks chunk (cx, cy) discovered; true when it was new. */
function discover(pm: PlayerMapWorld, m: PlayerMap, cx: number, cy: number): boolean {
  const x = cx - pm.cx0;
  const y = cy - pm.cy0;
  if (x < 0 || y < 0 || x >= pm.width || y >= pm.height) return false;
  const i = y * pm.width + x;
  const mask = 1 << (i & 7);
  if ((m.bits[i >> 3]! & mask) !== 0) return false;
  m.bits[i >> 3]! |= mask;
  return true;
}

export const isDiscovered = (pm: PlayerMapWorld, m: PlayerMap, cx: number, cy: number): boolean => {
  const x = cx - pm.cx0;
  const y = cy - pm.cy0;
  if (x < 0 || y < 0 || x >= pm.width || y >= pm.height) return false;
  const i = y * pm.width + x;
  return (m.bits[i >> 3]! & (1 << (i & 7))) !== 0;
};

/**
 * Pipeline step `playerMap` (last): every `discoverEverySec` each living player discovers the
 * chunks touching the circle of their current sight range (night, wounds and lights included;
 * no line-of-sight test) and extends the trail when `trailSpacingM` away from its last point.
 */
export function playerMapSystem(w: SimWorld, grid?: TileGrid): void {
  const pm = w.playerMap;
  if (!pm) return;
  const second = w.tick % pm.cfg.discoverEveryTicks === 0;
  if (second || w.tick % pm.cfg.senseEveryTicks === 0) senseZombies(w, pm, grid, second);
  if (second) updatePlayerMaps(w, pm, true, grid);
}

/**
 * Start state (createSim, after a load): the spawn area is discovered and the trail starts,
 * without events, so the first view already has them and tick 0 changes nothing.
 */
export function primePlayerMaps(w: SimWorld, grid?: TileGrid): void {
  if (w.playerMap) updatePlayerMaps(w, w.playerMap, false, grid);
}

function updatePlayerMaps(
  w: SimWorld,
  pm: PlayerMapWorld,
  emit: boolean,
  grid: TileGrid | undefined,
): void {
  const { Position, StableId } = w.c;
  for (const [playerId, eid] of [...w.players.entries()].sort((a, b) => a[0] - b[0])) {
    if (w.survival?.dead[eid]) continue;
    const m = playerMapOf(pm, StableId.value[eid] ?? 0);
    const x = Position.x[eid] ?? 0;
    const y = Position.y[eid] ?? 0;
    const r = Math.max(1, w.ai ? playerSightRange(w, w.ai, eid) : DEFAULT_SIGHT_TILES);
    const cells: [number, number][] = [];
    const ca = Math.floor((x - r) / CHUNK_SIZE);
    const cb = Math.floor((x + r) / CHUNK_SIZE);
    const ra = Math.floor((y - r) / CHUNK_SIZE);
    const rb = Math.floor((y + r) / CHUNK_SIZE);
    for (let cy = ra; cy <= rb; cy++) {
      for (let cx = ca; cx <= cb; cx++) {
        const dx = Math.max(cx * CHUNK_SIZE - x, 0, x - (cx + 1) * CHUNK_SIZE);
        const dy = Math.max(cy * CHUNK_SIZE - y, 0, y - (cy + 1) * CHUNK_SIZE);
        if (dx * dx + dy * dy > r * r) continue;
        if (discover(pm, m, cx, cy)) cells.push([cx, cy]);
      }
    }
    if (emit && cells.length > 0)
      w.events.push({ type: 'chunksDiscovered', tick: w.tick, playerId, cells });
    updateRooms(w, grid, m, StableId.value[eid] ?? 0, x, y, floorZ(w, eid), r);
    const n = m.trail.length;
    const px = Math.round(x);
    const py = Math.round(y);
    const lx = n > 0 ? m.trail[n - 2]! : NaN;
    const ly = n > 0 ? m.trail[n - 1]! : NaN;
    const sp = pm.cfg.trailSpacingM;
    if (n === 0 || (px - lx) * (px - lx) + (py - ly) * (py - ly) >= sp * sp) {
      m.trail.push(px, py);
      if (m.trail.length / 2 > pm.cfg.trailMaxPoints) {
        // Drop the oldest tenth at once (the view resends the whole trail).
        const drop = Math.max(1, Math.floor(pm.cfg.trailMaxPoints / 10));
        m.trail.splice(0, drop * 2);
        m.trailSent = -1;
      }
    }
  }
}

// --- floor plan --------------------------------------------------------------------------

const STATE_RANK: Record<RoomIntelState, number> = { seen: 1, searched: 2 };

/** Room id of tile (tx, ty, z), with its chunk (0 = outside / no rooms). */
function roomAt(w: SimWorld, tx: number, ty: number, z: number) {
  const cx = Math.floor(tx / CHUNK_SIZE);
  const cy = Math.floor(ty / CHUNK_SIZE);
  const chunk = w.source.getChunk(cx, cy, z);
  const room = chunk?.room?.[(ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE)] ?? 0;
  return { cx, cy, room };
}

/** Raises a room's state (never lowers it); new rooms only under `MAX_MAP_ROOMS`. */
function raise(
  m: PlayerMap,
  cx: number,
  cy: number,
  z: number,
  room: number,
  state: RoomIntelState,
): void {
  const key = roomKey(cx, cy, z, room);
  const r = m.rooms.get(key);
  if (r) {
    if (STATE_RANK[r.state] >= STATE_RANK[state]) return;
    r.state = state;
  } else {
    if (m.rooms.size >= MAX_MAP_ROOMS) return;
    m.rooms.set(key, { cx, cy, z, room, state });
  }
  m.roomsAdd.add(key);
}

/** World storages of the room's part in chunk (cx, cy) and how many `sid` searched. */
function storages(w: SimWorld, cx: number, cy: number, z: number, room: number, sid: number) {
  const st = w.items;
  const layer = w.source.getChunk(cx, cy, z)?.room;
  let total = 0;
  let done = 0;
  if (st && layer) {
    for (let i = 0; i < layer.length; i++) {
      if (layer[i] !== room) continue;
      const tx = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
      const ty = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      for (const id of st.worldByTile.get(tileKey(tx, ty, z)) ?? []) {
        const c = st.containers.get(id);
        if (c?.kind !== 'world') continue;
        total++;
        if (c.searchedBy.includes(sid)) done++;
      }
    }
  }
  return { total, done };
}

/**
 * Rooms in sight become `seen`: every room tile within the sight range (capped) on the player's
 * floor with a line of sight to its centre; tiles of rooms already known are skipped. The room
 * the player stands in is `searched` when it has no storages left unsearched.
 */
function updateRooms(
  w: SimWorld,
  grid: TileGrid | undefined,
  m: PlayerMap,
  sid: number,
  x: number,
  y: number,
  z: number,
  sight: number,
): void {
  const here = roomAt(w, Math.floor(x), Math.floor(y), z);
  if (here.room !== 0) {
    raise(m, here.cx, here.cy, z, here.room, 'seen');
    const s = storages(w, here.cx, here.cy, z, here.room, sid);
    if (s.done === s.total) raise(m, here.cx, here.cy, z, here.room, 'searched');
  }
  if (!grid) return;
  const r = Math.min(sight, ROOM_SIGHT_MAX_TILES);
  const ca = Math.floor((x - r) / CHUNK_SIZE);
  const cb = Math.floor((x + r) / CHUNK_SIZE);
  const ra = Math.floor((y - r) / CHUNK_SIZE);
  const rb = Math.floor((y + r) / CHUNK_SIZE);
  for (let cy = ra; cy <= rb; cy++) {
    for (let cx = ca; cx <= cb; cx++) {
      const layer = w.source.getChunk(cx, cy, z)?.room;
      if (!layer) continue;
      // Room id → already known (one key lookup per room, not per tile).
      const known = new Map<number, boolean>();
      for (let i = 0; i < layer.length; i++) {
        const room = layer[i]!;
        if (room === 0) continue;
        let k = known.get(room);
        if (k === undefined) known.set(room, (k = m.rooms.has(roomKey(cx, cy, z, room))));
        if (k) continue;
        const tx = cx * CHUNK_SIZE + (i % CHUNK_SIZE) + 0.5;
        const ty = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE) + 0.5;
        const dx = tx - x;
        const dy = ty - y;
        if (dx * dx + dy * dy > r * r) continue;
        if (lineOfSight(grid, z, x, y, tx, ty)) {
          raise(m, cx, cy, z, room, 'seen');
          known.set(room, true);
        }
      }
    }
  }
}

/** A world storage searched by player `eid` (items/actions.ts): may make its room `searched`. */
export function noteContainerSearched(w: SimWorld, eid: number, c: ItemContainer): void {
  const pm = w.playerMap;
  if (!pm || c.kind !== 'world') return;
  const { cx, cy, room } = roomAt(w, c.x, c.y, c.z);
  if (room === 0) return;
  const sid = w.c.StableId.value[eid] ?? 0;
  const m = playerMapOf(pm, sid);
  const s = storages(w, cx, cy, c.z, room, sid);
  raise(m, cx, cy, c.z, room, s.done === s.total ? 'searched' : 'seen');
}

const roomView = (r: MapRoom): RoomIntelView => ({
  cx: r.cx,
  cy: r.cy,
  z: r.z,
  room: r.room,
  state: r.state,
});

const byRoom = (a: MapRoom, b: MapRoom): number =>
  a.z - b.z || a.cy - b.cy || a.cx - b.cx || a.room - b.room;

const sortedRooms = (m: PlayerMap): MapRoom[] => [...m.rooms.values()].sort(byRoom);

// --- zombies ----------------------------------------------------------------------------------

/**
 * Zombies each living player senses: seen (same floor, within sight range, line of sight) or
 * heard (within `hearTiles`, at most one floor apart). With `record` (once a second) the sensed
 * ones update the sightings (newest `maxSightings` kept).
 */
function senseZombies(
  w: SimWorld,
  pm: PlayerMapWorld,
  grid: TileGrid | undefined,
  record: boolean,
): void {
  const ai = w.ai;
  const { Position, StableId, Zombie } = w.c;
  const zombies = ai && ai.zombieCount > 0 ? sortedQuery(w, 'zombies', [Zombie]) : [];
  const hear = pm.cfg.hearTiles;
  for (const [, eid] of [...w.players.entries()].sort((a, b) => a[0] - b[0])) {
    const m = playerMapOf(pm, StableId.value[eid] ?? 0);
    const sensed: number[] = [];
    if (!w.survival?.dead[eid] && ai) {
      const x = Position.x[eid] ?? 0;
      const y = Position.y[eid] ?? 0;
      const z = floorZ(w, eid);
      const r = playerSightRange(w, ai, eid);
      for (const zid of zombies) {
        const zz = floorZ(w, zid);
        const zx = Position.x[zid] ?? 0;
        const zy = Position.y[zid] ?? 0;
        const d2 = (zx - x) * (zx - x) + (zy - y) * (zy - y);
        const heard = Math.abs(zz - z) <= 1 && d2 <= hear * hear;
        const seen =
          !heard && zz === z && d2 <= r * r && (!grid || lineOfSight(grid, z, x, y, zx, zy));
        if (!heard && !seen) continue;
        const sid = StableId.value[zid] ?? 0;
        sensed.push(sid);
        if (record) {
          m.sightings.delete(sid);
          m.sightings.set(sid, { x: zx, y: zy, z: zz, tick: w.tick });
          m.sightingsDirty = true;
        }
      }
    }
    sensed.sort((a, b) => a - b);
    if (sensed.length !== m.sensed.length || sensed.some((v, i) => v !== m.sensed[i])) {
      m.sensed = sensed;
      m.sensedDirty = true;
    }
    // Map insertion order = observation order: drop the oldest beyond the limit.
    while (m.sightings.size > pm.cfg.maxSightings) {
      m.sightings.delete(m.sightings.keys().next().value!);
    }
  }
}

/** `sensedZombies` for character `sid` when it changed (consumes the flag). */
export function sensedZombiesPatch(w: SimWorld, sid: number): number[] | undefined {
  const pm = w.playerMap;
  if (!pm) return undefined;
  const m = playerMapOf(pm, sid);
  if (!m.sensedDirty) return undefined;
  m.sensedDirty = false;
  return [...m.sensed];
}

const sightingViews = (m: PlayerMap): ZombieSightingView[] =>
  [...m.sightings.values()].reverse().map((v) => ({ ...v }));

// --- markers -------------------------------------------------------------------------------

type MarkerCommand = Extract<Command, { type: 'addMarker' | 'editMarker' | 'removeMarker' }>;
export const MARKER_COMMANDS: ReadonlySet<Command['type']> = new Set<Command['type']>([
  'addMarker',
  'editMarker',
  'removeMarker',
]);
export const isMarkerCommand = (cmd: Command): cmd is MarkerCommand =>
  MARKER_COMMANDS.has(cmd.type);

/** Control characters out, cut to `max` characters (code points). */
function cleanText(text: string | undefined, max: number): string {
  // eslint-disable-next-line no-control-regex
  return Array.from((text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim())
    .slice(0, max)
    .join('');
}

const sortedMarkers = (m: PlayerMap): MapMarkerView[] =>
  [...m.markers.values()].sort((a, b) => a.id - b.id).map((k) => ({ ...k }));

/**
 * `addMarker` / `editMarker` / `removeMarker`, applied at once (outside the tick, also in
 * pause). Emits `markersChanged` with the full list; returns the reject reason otherwise.
 */
export function applyMarkerCommand(
  w: SimWorld,
  cmd: MarkerCommand,
): CommandRejectReason | undefined {
  const pm = w.playerMap;
  const eid = w.players.get(cmd.playerId);
  if (!pm || eid === undefined) return 'unknown-player';
  const m = playerMapOf(pm, w.c.StableId.value[eid] ?? 0);
  const cfg = pm.cfg;
  const inWorld = (x: number, y: number): boolean =>
    x >= pm.cx0 * CHUNK_SIZE &&
    y >= pm.cy0 * CHUNK_SIZE &&
    x < (pm.cx0 + pm.width) * CHUNK_SIZE &&
    y < (pm.cy0 + pm.height) * CHUNK_SIZE;
  let changed: number;
  let change: 'added' | 'edited' | 'removed';
  if (cmd.type === 'removeMarker') {
    if (!m.markers.delete(cmd.id)) return 'unknown-marker';
    changed = cmd.id;
    change = 'removed';
  } else {
    const old = cmd.type === 'editMarker' ? m.markers.get(cmd.id) : undefined;
    if (cmd.type === 'editMarker' && !old) return 'unknown-marker';
    if (cmd.type === 'addMarker' && m.markers.size >= cfg.maxMarkers) return 'marker-limit';
    const x = Math.fround(cmd.x ?? old!.x);
    const y = Math.fround(cmd.y ?? old!.y);
    const z = cmd.z ?? old?.z ?? 0;
    const icon = cmd.icon ?? old!.icon;
    const color = cmd.color ?? old!.color;
    if (
      !cfg.icons.includes(icon) ||
      !cfg.colors.includes(color) ||
      !inWorld(x, y) ||
      !Number.isInteger(z) ||
      z < pm.z0 ||
      z > pm.z1
    )
      return 'invalid-target';
    const text =
      cmd.text !== undefined ? cleanText(cmd.text, cfg.maxTextLength) : (old?.text ?? '');
    const showOnMinimap = cmd.showOnMinimap ?? old?.showOnMinimap ?? true;
    const id = old ? old.id : m.nextId++;
    m.markers.set(id, { id, x, y, icon, color, text, showOnMinimap, z });
    changed = id;
    change = old ? 'edited' : 'added';
  }
  m.markersDirty = true;
  w.events.push({
    type: 'markersChanged',
    tick: w.tick,
    playerId: cmd.playerId,
    change,
    changed,
    markers: sortedMarkers(m),
  });
  return undefined;
}

// --- view ----------------------------------------------------------------------------------

/** `worldMap` patch for character `sid` (consumes the map's dirty flags). */
export function worldMapPatch(w: SimWorld, sid: number): WorldMapView | undefined {
  const pm = w.playerMap;
  if (!pm) return undefined;
  const m = playerMapOf(pm, sid);
  const out: WorldMapView = {};
  if (m.sendAll) {
    out.bounds = {
      cx0: pm.cx0,
      cy0: pm.cy0,
      cx1: pm.cx0 + pm.width - 1,
      cy1: pm.cy0 + pm.height - 1,
    };
    out.discovered = toBase64(m.bits);
    out.markers = sortedMarkers(m);
    out.rooms = sortedRooms(m).map(roomView);
    out.zombieSightings = sightingViews(m);
    m.trailSent = -1;
    m.markersDirty = false;
    m.roomsAdd.clear();
    m.sightingsDirty = false;
    m.sendAll = false;
  }
  if (m.trailSent < 0) {
    out.trail = [...m.trail];
    m.trailSent = m.trail.length;
  } else if (m.trailSent < m.trail.length) {
    out.trailAdd = m.trail.slice(m.trailSent);
    m.trailSent = m.trail.length;
  }
  if (m.markersDirty) {
    out.markers = sortedMarkers(m);
    m.markersDirty = false;
  }
  if (m.roomsAdd.size > 0) {
    out.roomsAdd = [...m.roomsAdd]
      .map((k) => m.rooms.get(k)!)
      .sort(byRoom)
      .map(roomView);
    m.roomsAdd.clear();
  }
  if (m.sightingsDirty) {
    out.zombieSightings = sightingViews(m);
    m.sightingsDirty = false;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// --- save ----------------------------------------------------------------------------------

export type SavedMarker =
  | [number, number, number, string, MarkerColor, string]
  | [number, number, number, string, MarkerColor, string, boolean]
  | [number, number, number, string, MarkerColor, string, boolean, number];

export interface PlayerMapSave {
  sid: number;
  /** Bitmap bytes, `encodeZeroRle` (runs of zero bytes folded). */
  discovered: string;
  /** Trail: zigzag varint deltas of whole metres, base64 (`encodeTrail`). */
  trail: string;
  /**
   * `[id, x, y, icon, color, text]`, plus `false` when hidden from the minimap (missing = shown),
   * plus the floor when not 0 (then the 7th is always written).
   */
  markers: SavedMarker[];
  nextId: number;
  /** Floor plan rooms (`encodeRooms`), absent when none (older saves). Sightings are not saved. */
  rooms?: string;
}

const zig = (v: number): number => (v >= 0 ? v * 2 : -v * 2 - 1);
const unzig = (u: number): number => (u % 2 === 0 ? u / 2 : -(u + 1) / 2);

/** Trail points as zigzag LEB128 deltas (first point from 0, 0): ~2–3 bytes per point. */
export function encodeTrail(trail: readonly number[]): string {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  const varint = (v: number): void => {
    let x = v;
    while (x >= 0x80) {
      out.push((x % 0x80) | 0x80);
      x = Math.floor(x / 0x80);
    }
    out.push(x);
  };
  for (let i = 0; i < trail.length; i += 2) {
    varint(zig(trail[i]! - px));
    varint(zig(trail[i + 1]! - py));
    px = trail[i]!;
    py = trail[i + 1]!;
  }
  return toBase64(Uint8Array.from(out));
}

export function decodeTrail(s: string): number[] {
  const b = fromBase64(s);
  const out: number[] = [];
  let p = 0;
  const varint = (): number => {
    let v = 0;
    let mul = 1;
    for (;;) {
      if (p >= b.length) throw new Error('save: truncated trail');
      const x = b[p++]!;
      v += (x & 0x7f) * mul;
      if (x < 0x80) return v;
      mul *= 0x80;
    }
  };
  let px = 0;
  let py = 0;
  while (p < b.length) {
    px += unzig(varint());
    py += unzig(varint());
    out.push(px, py);
  }
  return out;
}

const ROOM_FIELDS = 5;

/**
 * Rooms as zigzag LEB128 records, sorted by (z, cy, cx, room): Δcx, Δcy, Δz (from the previous
 * room), room, state (`ROOM_INTEL_STATES` index). ~5 bytes per room.
 */
export function encodeRooms(rooms: readonly MapRoom[]): string {
  const out: number[] = [];
  const varint = (v: number): void => {
    let x = v;
    while (x >= 0x80) {
      out.push((x % 0x80) | 0x80);
      x = Math.floor(x / 0x80);
    }
    out.push(x);
  };
  let px = 0;
  let py = 0;
  let pz = 0;
  for (const r of rooms) {
    varint(zig(r.cx - px));
    varint(zig(r.cy - py));
    varint(zig(r.z - pz));
    varint(r.room);
    varint(ROOM_INTEL_STATES.indexOf(r.state));
    px = r.cx;
    py = r.cy;
    pz = r.z;
  }
  return toBase64(Uint8Array.from(out));
}

/** Inverse of `encodeRooms`; throws on malformed data. */
export function decodeRooms(s: string): MapRoom[] {
  const b = fromBase64(s);
  const vals: number[] = [];
  let p = 0;
  while (p < b.length) {
    let v = 0;
    let mul = 1;
    for (;;) {
      if (p >= b.length) throw new Error('save: truncated rooms');
      const x = b[p++]!;
      v += (x & 0x7f) * mul;
      if (x < 0x80) break;
      mul *= 0x80;
    }
    vals.push(v);
  }
  if (vals.length % ROOM_FIELDS !== 0 || vals.length / ROOM_FIELDS > MAX_MAP_ROOMS)
    throw new Error('save: bad rooms');
  const out: MapRoom[] = [];
  let cx = 0;
  let cy = 0;
  let z = 0;
  for (let i = 0; i < vals.length; i += ROOM_FIELDS) {
    cx += unzig(vals[i]!);
    cy += unzig(vals[i + 1]!);
    z += unzig(vals[i + 2]!);
    const room = vals[i + 3]!;
    const state = ROOM_INTEL_STATES[vals[i + 4]!];
    if (room < 1 || room > 0xffff || !state) throw new Error('save: bad room');
    out.push({ cx, cy, z, room, state });
  }
  return out;
}

export function encodePlayerMaps(pm: PlayerMapWorld | undefined): PlayerMapSave[] | undefined {
  if (!pm || pm.maps.size === 0) return undefined;
  return [...pm.maps.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sid, m]) => ({
      sid,
      discovered: encodeZeroRle(m.bits),
      trail: encodeTrail(m.trail),
      markers: sortedMarkers(m).map((k): SavedMarker =>
        k.z
          ? [k.id, k.x, k.y, k.icon, k.color, k.text, k.showOnMinimap !== false, k.z]
          : k.showOnMinimap === false
            ? [k.id, k.x, k.y, k.icon, k.color, k.text, false]
            : [k.id, k.x, k.y, k.icon, k.color, k.text],
      ),
      nextId: m.nextId,
      ...(m.rooms.size > 0 ? { rooms: encodeRooms(sortedRooms(m)) } : {}),
    }));
}

/** Restores the maps of a save (same world bounds; the view resends everything). */
export function decodePlayerMaps(
  pm: PlayerMapWorld | undefined,
  saved: PlayerMapSave[] | undefined,
): void {
  if (!pm) return;
  pm.maps.clear();
  for (const s of saved ?? []) {
    const m = newMap(pm);
    decodeZeroRle(s.discovered, m.bits);
    m.trail = decodeTrail(s.trail);
    for (const [id, x, y, icon, color, text, mini, z] of s.markers)
      m.markers.set(id, { id, x, y, icon, color, text, showOnMinimap: mini !== false, z: z ?? 0 });
    m.nextId = s.nextId;
    for (const r of s.rooms ? decodeRooms(s.rooms) : [])
      m.rooms.set(roomKey(r.cx, r.cy, r.z, r.room), r);
    pm.maps.set(s.sid, m);
  }
}
