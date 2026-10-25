/**
 * Big map (M) view model and pure helpers (deadzone-hud-v2-spec §11). World metres (sim x, y;
 * y grows to the south, the map is north-up). The fog bitmap / trail / markers come from a
 * `BigMapSource` (see bigmap-source.ts).
 */
import {
  CHUNK_SIZE_M,
  MAP_CHUNKS,
  MAP_MARKER_ICONS,
  MAP_MARKER_TEXT_MAX,
  MAX_MAP_MARKERS,
  PLAYER_MAP_TRAIL_MAX_POINTS,
  PLAYER_MAP_TRAIL_SPACING_M,
  SAVE_MARKER_COLORS,
  type MapMarkerIcon,
  type SaveMarkerColor,
} from '@deadzone/protocol';

/** Marker icons: content ids from the protocol (`MAP_MARKER_ICONS`, same as the sim's list). */
export const MARKER_ICONS = MAP_MARKER_ICONS;
export type MarkerIcon = MapMarkerIcon;

/** Marker colours: protocol names (`SAVE_MARKER_COLORS`); `MARKER_HEX` = how they are drawn. */
export const MARKER_COLORS = SAVE_MARKER_COLORS;
export type MarkerColor = SaveMarkerColor;
export const MARKER_HEX: Record<MarkerColor, string> = {
  yellow: '#E0A23A',
  red: '#C8453C',
  green: '#7F9A4E',
  blue: '#4F86C6',
  white: '#E4E6E3',
};
/** Drawn colour of a marker colour name (unknown → white). */
export const markerHex = (c: string): string => MARKER_HEX[c as MarkerColor] ?? MARKER_HEX.white;

export const MARKER_TEXT_MAX = MAP_MARKER_TEXT_MAX;
export const MARKER_LIMIT = MAX_MAP_MARKERS;

export interface Marker {
  id: number;
  x: number;
  y: number;
  /** Content id (`base:marker-food`, …); unknown ids draw a plain pin. */
  icon: string;
  color: MarkerColor;
  text: string;
  /** Client-side only (the sim does not store it): pin also on the minimap. */
  showOnMinimap: boolean;
  /** Floor (protocol 22, `MapMarkerView.z`); a new marker without it goes on the player's floor. */
  z?: number;
}

export type MarkerDraft = Omit<Marker, 'id'>;

export interface BigMapLayers {
  markers: boolean;
  trail: boolean;
  grid: boolean;
}

/** Contract from the spec (§11 „Dane / kontrakty”). */
export interface BigMapVM {
  open: boolean;
  zoom: number;
  center: { x: number; y: number };
  layers: BigMapLayers;
  /** Discovery bitmap over the sim's chunk bounds (see `FogGrid`). */
  fog: FogGrid;
  /** x0, y0, x1, y1, … (metres); NaN pair = break in the line. */
  trail: Float32Array;
  markers: readonly Marker[];
  player: { x: number; y: number; heading: number };
  cursor: { x: number; y: number } | undefined;
}

/** World size from the protocol (`MAP_CHUNKS` × `CHUNK_SIZE_M`; 512 × 32 m = 16 384 m). */
export const FOG_CHUNK_M = CHUNK_SIZE_M;
export const WORLD_M = MAP_CHUNKS * FOG_CHUNK_M;

/**
 * Fog of war: one bit per chunk over the sim's chunk bounds (`worldMap.bounds`, inclusive),
 * row-major from (cx0, cy0), bit i = byte i >> 3, mask 1 << (i & 7). Chunk (cx, cy) covers
 * world metres [cx · 32, cx · 32 + 32), so the map's origin is (cx0 · 32, cy0 · 32).
 */
export interface FogGrid {
  cx0: number;
  cy0: number;
  width: number;
  height: number;
  bits: Uint8Array;
}

export interface ChunkBounds {
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
}

/** Until the sim sends bounds: the protocol's whole map from chunk (0, 0). */
export const DEFAULT_FOG_BOUNDS: ChunkBounds = {
  cx0: 0,
  cy0: 0,
  cx1: MAP_CHUNKS - 1,
  cy1: MAP_CHUNKS - 1,
};

/** An all-fog grid over `b` (or wraps `bits`, e.g. decoded from the sim's base64). */
export function fogGrid(b: ChunkBounds = DEFAULT_FOG_BOUNDS, bits?: Uint8Array): FogGrid {
  const width = b.cx1 - b.cx0 + 1;
  const height = b.cy1 - b.cy0 + 1;
  return {
    cx0: b.cx0,
    cy0: b.cy0,
    width,
    height,
    bits: bits ?? new Uint8Array(Math.ceil((width * height) / 8)),
  };
}

/** World metre of the grid's corner (chunk cx0, cy0). */
export const gridOrigin = (g: FogGrid) => ({ x: g.cx0 * FOG_CHUNK_M, y: g.cy0 * FOG_CHUNK_M });

/** World rectangle covered by the grid. */
export const gridBounds = (g: FogGrid) => {
  const o = gridOrigin(g);
  return { x0: o.x, y0: o.y, x1: o.x + g.width * FOG_CHUNK_M, y1: o.y + g.height * FOG_CHUNK_M };
};

/** base64 → bytes (browser `atob`, Node `Buffer` in tests). */
export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 1,0× = 0.347 px/m (1 km ≈ 347 px). */
export const PX_PER_M = 0.3466796875;
/**
 * Spec: 0,25× shows the whole 8 km world (≈ 710 px). A bigger world keeps that: the minimum
 * scales down so the whole world still fits (16 km → 0,125×).
 */
export const ZOOM_MIN = Math.min(0.25, 0.25 * (8192 / WORLD_M));
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;
export const ZOOM_ANIM_MS = 120;
/** Labels hide below this zoom (icons stay, tooltip on hover). */
export const LABEL_MIN_ZOOM = 0.5;

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
export const stepZoom = (z: number, dir: number): number => clampZoom(z * ZOOM_STEP ** dir);

/** `1,0×`, `0,64×` (Polish decimal comma). */
export const zoomText = (z: number): string =>
  `${z >= 1 ? z.toFixed(1) : z.toFixed(2)}`.replace('.', ',') + '×';

export interface Viewport {
  width: number;
  height: number;
}

export interface View {
  center: { x: number; y: number };
  zoom: number;
}

export const ppm = (zoom: number): number => PX_PER_M * zoom;

export function worldToScreen(v: View, vp: Viewport, x: number, y: number) {
  const k = ppm(v.zoom);
  return { x: vp.width / 2 + (x - v.center.x) * k, y: vp.height / 2 + (y - v.center.y) * k };
}

export function screenToWorld(v: View, vp: Viewport, sx: number, sy: number) {
  const k = ppm(v.zoom);
  return { x: v.center.x + (sx - vp.width / 2) / k, y: v.center.y + (sy - vp.height / 2) / k };
}

/** New center so the world point under the cursor stays put when zooming to `zoom`. */
export function zoomAround(v: View, vp: Viewport, sx: number, sy: number, zoom: number): View {
  const p = screenToWorld(v, vp, sx, sy);
  const k = ppm(zoom);
  return {
    zoom,
    center: { x: p.x - (sx - vp.width / 2) / k, y: p.y - (sy - vp.height / 2) / k },
  };
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The world edge may come at most to the screen centre (½ screen of slack). */
export const clampCenter = (c: { x: number; y: number }, b: Bounds) => ({
  x: Math.min(b.x1, Math.max(b.x0, c.x)),
  y: Math.min(b.y1, Math.max(b.y0, c.y)),
});

/** Scale bar: a round length (100 / 150 / … m, 1 / 1,5 / 2 km) drawn 120–200 px long. */
export function scaleBar(zoom: number): { meters: number; px: number; labels: string[] } {
  const k = ppm(zoom);
  const steps = [50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 4000];
  let best = steps[0]!;
  for (const m of steps) {
    const px = m * k;
    if (px >= 120 && px <= 200) {
      best = m;
      break;
    }
    if (Math.abs(px - 160) < Math.abs(best * k - 160)) best = m;
  }
  const fmt = (m: number, unit: boolean) =>
    m >= 1000 && best >= 1000
      ? `${String(m / 1000).replace('.', ',')}${unit ? ' km' : ''}`
      : `${m}${unit ? ' m' : ''}`;
  return {
    meters: best,
    px: Math.round(best * k),
    labels: ['0', fmt(best / 2, false), fmt(best, true)],
  };
}

/** 1 km grid cells per side (8 km → A–H / 1–8, 16 km → A–Q / 1–17). */
export const gridCells = (g: FogGrid) => ({
  cols: Math.ceil((g.width * FOG_CHUNK_M) / 1000),
  rows: Math.ceil((g.height * FOG_CHUNK_M) / 1000),
});

/** 1 km grid cell, columns A…, rows 1… from the map origin (`E5`). */
export function gridCell(g: FogGrid, x: number, y: number): string {
  const o = gridOrigin(g);
  const { cols, rows } = gridCells(g);
  const c = Math.floor((x - o.x) / 1000);
  const r = Math.floor((y - o.y) / 1000);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return '–';
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

/** `4 150` (thin-space thousands, like the mockup). */
export const metres = (v: number): string =>
  Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Footer cursor text: `E5 · 4 150 / 4 610 m` (metres from the map origin). */
export const cursorText = (g: FogGrid, x: number, y: number): string => {
  const o = gridOrigin(g);
  return `${gridCell(g, x, y)} · ${metres(x - o.x)} / ${metres(y - o.y)} m`;
};

/** `970 m` / `1,2 km`. */
export const distanceText = (m: number): string =>
  m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;

const inGrid = (g: FogGrid, cx: number, cy: number): boolean =>
  cx >= g.cx0 && cy >= g.cy0 && cx < g.cx0 + g.width && cy < g.cy0 + g.height;

/** Bit index of world chunk (cx, cy): (cy − cy0) · width + (cx − cx0). */
export const fogIndex = (g: FogGrid, cx: number, cy: number): number =>
  (cy - g.cy0) * g.width + (cx - g.cx0);

export function isDiscovered(g: FogGrid, cx: number, cy: number): boolean {
  if (!inGrid(g, cx, cy)) return false;
  const i = fogIndex(g, cx, cy);
  return ((g.bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
}

export function setDiscovered(g: FogGrid, cx: number, cy: number): boolean {
  if (!inGrid(g, cx, cy)) return false;
  const i = fogIndex(g, cx, cy);
  const before = g.bits[i >> 3] ?? 0;
  g.bits[i >> 3] = before | (1 << (i & 7));
  return g.bits[i >> 3] !== before;
}

/** World chunk of a world point (same chunks as the sim). */
export const fogChunk = (x: number, y: number) => ({
  cx: Math.floor(x / FOG_CHUNK_M),
  cy: Math.floor(y / FOG_CHUNK_M),
});

export function discoveredCount(g: FogGrid): number {
  let n = 0;
  for (const b of g.bits) {
    let v = b;
    while (v) {
      v &= v - 1;
      n++;
    }
  }
  return n;
}

/** `odkryto 2 027 / 65 536 chunków (3,1 %)`. */
export function discoveredText(g: FogGrid): { count: string; rest: string } {
  const n = discoveredCount(g);
  const total = g.width * g.height;
  return {
    count: metres(n),
    rest: ` / ${metres(total)} chunków (${((n / total) * 100).toFixed(1).replace('.', ',')} %)`,
  };
}

/** A jump longer than 4 trail steps (protocol `PLAYER_MAP_TRAIL_SPACING_M`) breaks the line. */
export const TRAIL_BREAK_M = 4 * PLAYER_MAP_TRAIL_SPACING_M;
/** The sim keeps at most this many trail points (protocol). */
export const TRAIL_MAX_POINTS = PLAYER_MAP_TRAIL_MAX_POINTS;

/** Trail → polylines in world metres (NaN pairs or jumps > `maxGapM` break the line). */
export function trailSegments(
  trail: Float32Array,
  maxGapM = TRAIL_BREAK_M,
): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < trail.length; i += 2) {
    const x = trail[i]!;
    const y = trail[i + 1]!;
    const last = cur[cur.length - 1];
    if (
      Number.isNaN(x) ||
      Number.isNaN(y) ||
      (last && Math.hypot(x - last.x, y - last.y) > maxGapM)
    ) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
    }
    cur.push({ x, y });
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export type LabelSide = 'r' | 'b' | 't' | 'l';

/** Label rectangle beside a pin at (px, py) (pin Ø30). */
export function labelRect(px: number, py: number, w: number, h: number, side: LabelSide): Rect {
  switch (side) {
    case 'r':
      return { x: px + 22, y: py - h / 2, w, h };
    case 'l':
      return { x: px - 22 - w, y: py - h / 2, w, h };
    case 'b':
      return { x: px - w / 2, y: py + 22, w, h };
    case 't':
      return { x: px - w / 2, y: py - 22 - h, w, h };
  }
}

/**
 * Colliding labels move r → b → t → l (spec §11); one that fits nowhere keeps `r`. Pins block
 * labels too.
 */
export function placeLabels(
  items: readonly { x: number; y: number; w: number; h: number }[],
): LabelSide[] {
  const taken: Rect[] = items.map((p) => ({ x: p.x - 15, y: p.y - 15, w: 30, h: 30 }));
  return items.map((p) => {
    for (const side of ['r', 'b', 't', 'l'] as const) {
      const r = labelRect(p.x, p.y, p.w, p.h, side);
      if (!taken.some((t) => overlaps(t, r))) {
        taken.push(r);
        return side;
      }
    }
    taken.push(labelRect(p.x, p.y, p.w, p.h, 'r'));
    return 'r';
  });
}

/** Edit panel: +44 px right, −46 px up from the pin, flipped / clamped inside the viewport. */
export function panelPosition(
  px: number,
  py: number,
  w: number,
  h: number,
  vp: Viewport,
  top = 52,
  bottom = 38,
): { x: number; y: number; flipped: boolean } {
  let x = px + 44;
  let flipped = false;
  if (x + w > vp.width - 12) {
    x = px - 44 - w;
    flipped = true;
  }
  const y = Math.min(vp.height - bottom - 8 - h, Math.max(top + 8, py - 46));
  return { x: Math.max(12, x), y, flipped };
}

/**
 * Marker text length as the protocol counts it (Serwer #133, `saveMarkerSchema`): code points,
 * an emoji = 1, not UTF-16 units (`string.length`).
 */
export const markerTextLength = (t: string): number => Array.from(t).length;

/** Cuts marker text to `MAP_MARKER_TEXT_MAX` (40) code points, like the sim and the server. */
export const clampMarkerText = (t: string): string =>
  Array.from(t).slice(0, MARKER_TEXT_MAX).join('');

/**
 * Most UTF-16 units marker text can take (`saveMarkerSchema`: 2 × 40, every code point at most
 * a surrogate pair). For the `<input maxlength>` only; the real limit is `clampMarkerText`.
 */
export const MARKER_TEXT_MAX_UNITS = MARKER_TEXT_MAX * 2;
