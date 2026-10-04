import {
  CHUNK_SIZE,
  MAP_MARKER_ICONS,
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
}

export const DEFAULT_PLAYER_MAP: PlayerMapConfig = {
  icons: MAP_MARKER_ICONS,
  colors: MARKER_COLORS,
  maxMarkers: MAX_MAP_MARKERS,
  maxTextLength: MAP_MARKER_TEXT_MAX,
  discoverEveryTicks: TICKS_PER_SECOND,
  trailSpacingM: PLAYER_MAP_TRAIL_SPACING_M,
  trailMaxPoints: PLAYER_MAP_TRAIL_MAX_POINTS,
};

/** Sight range without the AI module (no content): daylight player sight. */
const DEFAULT_SIGHT_TILES = 30;

export interface PlayerMap {
  /** Discovered chunks, bit i = (cy − cy0) × width + (cx − cx0). */
  readonly bits: Uint8Array;
  /** Trail points [x0, y0, x1, y1, …] in whole metres, oldest first. */
  trail: number[];
  readonly markers: Map<number, MapMarkerView>;
  nextId: number;
  // View sync (derived, not saved): what the next `worldMap` patch must carry.
  sendAll: boolean;
  trailSent: number;
  markersDirty: boolean;
}

export interface PlayerMapWorld {
  readonly cfg: PlayerMapConfig;
  readonly cx0: number;
  readonly cy0: number;
  readonly width: number;
  readonly height: number;
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
    maps: new Map(),
  };
}

function newMap(pm: PlayerMapWorld): PlayerMap {
  return {
    bits: new Uint8Array(Math.ceil((pm.width * pm.height) / 8)),
    trail: [],
    markers: new Map(),
    nextId: 1,
    sendAll: true,
    trailSent: 0,
    markersDirty: false,
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
export function playerMapSystem(w: SimWorld): void {
  const pm = w.playerMap;
  if (!pm || w.tick % pm.cfg.discoverEveryTicks !== 0) return;
  updatePlayerMaps(w, pm, true);
}

/**
 * Start state (createSim, after a load): the spawn area is discovered and the trail starts,
 * without events, so the first view already has them and tick 0 changes nothing.
 */
export function primePlayerMaps(w: SimWorld): void {
  if (w.playerMap) updatePlayerMaps(w, w.playerMap, false);
}

function updatePlayerMaps(w: SimWorld, pm: PlayerMapWorld, emit: boolean): void {
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
    const icon = cmd.icon ?? old!.icon;
    const color = cmd.color ?? old!.color;
    if (!cfg.icons.includes(icon) || !cfg.colors.includes(color) || !inWorld(x, y))
      return 'invalid-target';
    const text =
      cmd.text !== undefined ? cleanText(cmd.text, cfg.maxTextLength) : (old?.text ?? '');
    const showOnMinimap = cmd.showOnMinimap ?? old?.showOnMinimap ?? true;
    const id = old ? old.id : m.nextId++;
    m.markers.set(id, { id, x, y, icon, color, text, showOnMinimap });
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
    m.trailSent = -1;
    m.markersDirty = false;
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
  return Object.keys(out).length > 0 ? out : undefined;
}

// --- save ----------------------------------------------------------------------------------

export type SavedMarker =
  | [number, number, number, string, MarkerColor, string]
  | [number, number, number, string, MarkerColor, string, boolean];

export interface PlayerMapSave {
  sid: number;
  /** Bitmap bytes, `encodeZeroRle` (runs of zero bytes folded). */
  discovered: string;
  /** Trail: zigzag varint deltas of whole metres, base64 (`encodeTrail`). */
  trail: string;
  /** `[id, x, y, icon, color, text]`, plus `false` when hidden from the minimap (missing = shown). */
  markers: SavedMarker[];
  nextId: number;
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

export function encodePlayerMaps(pm: PlayerMapWorld | undefined): PlayerMapSave[] | undefined {
  if (!pm || pm.maps.size === 0) return undefined;
  return [...pm.maps.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sid, m]) => ({
      sid,
      discovered: encodeZeroRle(m.bits),
      trail: encodeTrail(m.trail),
      markers: sortedMarkers(m).map((k): SavedMarker =>
        k.showOnMinimap === false
          ? [k.id, k.x, k.y, k.icon, k.color, k.text, false]
          : [k.id, k.x, k.y, k.icon, k.color, k.text],
      ),
      nextId: m.nextId,
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
    for (const [id, x, y, icon, color, text, mini] of s.markers)
      m.markers.set(id, { id, x, y, icon, color, text, showOnMinimap: mini !== false });
    m.nextId = s.nextId;
    pm.maps.set(s.sid, m);
  }
}
