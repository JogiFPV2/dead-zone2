/**
 * Big map overlays that stay visible over the fog (Designer, map-zoom1–3 mockups): the map
 * boundary („GRANICA MAPY”) and the names of towns / villages / districts. Pure helpers; the
 * drawing is in `bigmap-view.ts`.
 */
import type { Bounds, Rect } from './bigmap-model.js';

export interface Pt {
  x: number;
  y: number;
}

/** Boundary of the playable map: a closed polygon in world metres (rectangle by default). */
export type MapBoundary = readonly Pt[];

export const rectBoundary = (b: Bounds): MapBoundary => [
  { x: b.x0, y: b.y0 },
  { x: b.x1, y: b.y0 },
  { x: b.x1, y: b.y1 },
  { x: b.x0, y: b.y1 },
];

/**
 * A square of `size` metres rotated by `deg` (x east / y south, positive = clockwise on screen)
 * around its centre: the 16 km OSM square inside a bigger world (`OSM_ROTATION_DEG`).
 */
export function rotatedSquare(cx: number, cy: number, size: number, deg: number): MapBoundary {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const h = size / 2;
  return [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ].map(([dx, dy]) => ({ x: cx + dx! * c - dy! * s, y: cy + dx! * s + dy! * c }));
}

export function boundaryBounds(p: MapBoundary): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of p) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  return { x0, y0, x1, y1 };
}

/** `16,4 × 16,4 km` (first two edges of the polygon; one decimal, Polish comma). */
export function boundarySizeText(p: MapBoundary): string {
  if (p.length < 3) return '';
  const e = (i: number) => Math.hypot(p[i + 1]!.x - p[i]!.x, p[i + 1]!.y - p[i]!.y) / 1000;
  const km = (v: number) => v.toFixed(1).replace('.', ',');
  return `${km(e(0))} × ${km(e(1))} km`;
}

/** Corner the „GRANICA MAPY” tag hangs on: the bottom-left-most vertex (max y − x). */
export function boundaryTagCorner(p: MapBoundary): Pt | undefined {
  let best: Pt | undefined;
  for (const q of p) if (!best || q.y - q.x > best.y - best.x) best = q;
  return best;
}

/** Even-odd point-in-polygon test. */
export function insideBoundary(p: MapBoundary, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!;
    const b = p[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// --- place names ---------------------------------------------------------------------------

/** A named place of the map (generator `places()`: OSM `place` kind, world metres). */
export interface MapPlace {
  name: string;
  /** OSM `place` (city, town, village, hamlet, suburb, …) or content `PlaceKind`. */
  kind?: string | undefined;
  x: number;
  y: number;
}

/**
 * How a place is labelled: `town` big serif capitals with a „miasto” pill, `village` serif,
 * `district` italic (parts of a town), `hamlet` small italic (close zoom only).
 */
export type PlaceTier = 'town' | 'village' | 'district' | 'hamlet';

export function placeTier(kind: string | undefined): PlaceTier | undefined {
  switch (kind) {
    case 'city':
    case 'town':
      return 'town';
    case 'village':
    case undefined:
      return 'village';
    case 'suburb':
    case 'quarter':
    case 'district':
      return 'district';
    case 'neighbourhood':
    case 'hamlet':
      return 'hamlet';
    default:
      return undefined;
  }
}

/** Zoom from which each tier is labelled: towns and villages always (also below 0,5×). */
export const PLACE_MIN_ZOOM: Record<PlaceTier, number> = {
  town: 0,
  village: 0,
  district: 0.3,
  hamlet: 0.45,
};

/** Label fonts per tier (mockup map-zoom1: Georgia / DejaVu Serif). */
export const PLACE_FONT: Record<PlaceTier, string> = {
  town: '800 22px Georgia, "DejaVu Serif", serif',
  village: '700 11.5px Georgia, "DejaVu Serif", serif',
  district: 'italic 600 10.5px Georgia, "DejaVu Serif", serif',
  hamlet: 'italic 600 10px Georgia, "DejaVu Serif", serif',
};

/** Letter spacing (px) per tier, applied by drawing the label spaced out (towns). */
export const PLACE_TRACKING: Record<PlaceTier, number> = {
  town: 3,
  village: 0.7,
  district: 0.4,
  hamlet: 0.3,
};

const TIER_ORDER: Record<PlaceTier, number> = { town: 0, village: 1, district: 2, hamlet: 3 };

export interface PlaceLabel {
  place: MapPlace;
  tier: PlaceTier;
  /** Label text (towns in capitals). */
  text: string;
  /** Screen centre of the name. */
  x: number;
  y: number;
  /** Box taken by the label (name + the town pill), for collisions. */
  box: Rect;
}

const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Which place names to draw: tiers allowed at `zoom`, inside the viewport (+ margin), towns
 * first, then villages, districts, hamlets (ties: west → east); a label that would overlap one
 * already placed (or a `blocked` box, e.g. the player tag) is dropped.
 */
export function layoutPlaces(
  places: readonly MapPlace[],
  zoom: number,
  toScreen: (x: number, y: number) => Pt,
  measure: (text: string, tier: PlaceTier) => number,
  vp: { width: number; height: number },
  blocked: readonly Rect[] = [],
): PlaceLabel[] {
  const cand: PlaceLabel[] = [];
  for (const p of places) {
    const tier = placeTier(p.kind);
    if (!tier || zoom < PLACE_MIN_ZOOM[tier]) continue;
    const s = toScreen(p.x, p.y);
    if (s.x < -200 || s.y < -60 || s.x > vp.width + 200 || s.y > vp.height + 60) continue;
    const text = tier === 'town' ? p.name.toLocaleUpperCase('pl') : p.name;
    const w = measure(text, tier);
    const h = tier === 'town' ? 22 : 12;
    const box: Rect =
      tier === 'town'
        ? { x: s.x - w / 2 - 4, y: s.y - h / 2 - 2, w: w + 8, h: h + 22 }
        : { x: s.x - w / 2 - 3, y: s.y - h / 2 - 2, w: w + 6, h: h + 4 };
    cand.push({ place: p, tier, text, x: s.x, y: s.y, box });
  }
  cand.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.place.x - b.place.x);
  const taken: Rect[] = [...blocked];
  const out: PlaceLabel[] = [];
  for (const c of cand) {
    if (taken.some((t) => hit(t, c.box))) continue;
    taken.push(c.box);
    out.push(c);
  }
  return out;
}
