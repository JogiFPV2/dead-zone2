import type { OsmBuilding } from '../osm/types.js';
import {
  CONDITION,
  CONDITION_STATES,
  LOOK_PALETTE,
  type Condition,
  type LookType,
  type RoofShape,
} from './look-palette.js';

/** Block estates share one wall seed per cell of this size (m) when no residential area is known. */
export const ESTATE_CELL = 200;
/** Neighbours closer than this (m) never repeat the wall + roof pair. */
export const NEIGHBOUR_M = 15;

/** Look of one building (chunk `GenBuildingMeta` fields). */
export interface BuildingLook {
  look: LookType;
  wallColor: string;
  roofColor: string;
  trimColor: string;
  roofShape: RoofShape;
  condition: Condition;
  /** Church with a tower. */
  tower?: 1;
  /** Base wall + roof pair before the jitter (neighbour rule; not written to chunks). */
  pair: string;
}

/** Stable 32-bit hash in [0, 1) of two ints and a salt. */
export function lookHash(a: number, b: number, salt = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(salt, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function weighted(weights: readonly number[], r: number): number {
  const sum = weights.reduce((a, w) => a + w, 0) || 1;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]! / sum;
    if (r < acc) return i;
  }
  return Math.max(0, weights.length - 1);
}

/** Footprint area (m²) from which a 3+ floor office counts as a public building. */
export const PUBLIC_MIN_AREA = 600;

/**
 * Palette type of a building kind, refined by floors / footprint: houses with ≥ 3 floors and
 * tenements → `kamienica`, big 3+ floor offices and civic kinds → `public`; undefined = no
 * palette look (ruins).
 */
export function lookType(kind: string, floors: number, area: number): LookType | undefined {
  switch (kind) {
    case 'block':
    case 'kostka':
      return 'block';
    case 'tenement':
      return 'kamienica';
    case 'house':
      return floors >= 3 ? 'kamienica' : 'house';
    case 'office':
      return floors >= 3 && area >= PUBLIC_MIN_AREA ? 'public' : 'service';
    case 'shop':
    case 'pharmacy':
    case 'fuel':
    case 'gas':
    case 'gym':
    case 'bar':
      return 'service';
    case 'industrial':
      return 'industrial';
    case 'school':
      return 'school';
    case 'police':
      return 'police';
    case 'hospital':
      return 'hospital';
    case 'barn':
    case 'farm':
      return 'barn';
    case 'church':
    case 'fire-station':
    case 'station':
    case 'townhall':
      return 'public';
    case 'shed':
    case 'garage':
      return 'outbuilding';
    default:
      return undefined;
  }
}

/** OSM colour (name or hex) → hex clamped to muted tones (S ≤ 45 %, L 30–85 %). */
const NAMED: Readonly<Record<string, string>> = {
  white: '#f2f2f2',
  black: '#202020',
  grey: '#808080',
  gray: '#808080',
  red: '#a03a2c',
  brown: '#7a5034',
  yellow: '#e0cf8a',
  beige: '#e0d2b4',
  green: '#7d9a6e',
  blue: '#6c86a6',
  orange: '#d0905a',
  pink: '#d8a8a8',
  maroon: '#6e3426',
  silver: '#bfbfbf',
  cream: '#efe6cc',
};
export function clampColour(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  let hex = NAMED[v] ?? v;
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = '#' + [...hex.slice(1)].map((c) => c + c).join('');
  if (!/^#[0-9a-f]{6}$/.test(hex)) return undefined;
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let l = (mx + mn) / 2;
  const d = mx - mn;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  s = Math.min(s, 0.45);
  l = Math.min(0.85, Math.max(0.3, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const hx = (k: number) =>
    Math.round((k + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hx(r1)}${hx(g1)}${hx(b1)}`;
}

const SHAPES: ReadonlySet<string> = new Set([
  'flat',
  'gabled',
  'hipped',
  'shed',
  'mansard',
  'gambrel',
  'barrel',
  'sawtooth',
]);

/** Input of `buildingLook`: the OSM building plus its derived floors and footprint. */
export interface LookInput {
  b: Pick<OsmBuilding, 'id' | 'kind' | 'colour' | 'roofColour' | 'roofShape' | 'tall' | 'name'>;
  floors: number;
  /** Footprint bounding box (world metres). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Rural setting (house archetype rural weights, village condition weights). */
  rural?: boolean;
  /** Within 80 m of a railway (condition ×2). */
  nearRail?: boolean;
  /** On industrial land (condition ×2). */
  industrialArea?: boolean;
  /** City centre (condition ×0.5). */
  centre?: boolean;
  /** Pick shift for the neighbour rule (0 = first choice). */
  shift?: number;
}

/**
 * Look of a building (look-spec.md §A–C): OSM colour / roof shape first (clamped to muted
 * tones), otherwise the palette of its type with a seed from the OSM id (blocks: the estate
 * cell, so one estate shares its wall colour). Condition has its own seed.
 */
export function buildingLook(i: LookInput): BuildingLook | undefined {
  const { b } = i;
  const area = Math.abs((i.x1 - i.x0) * (i.y1 - i.y0));
  const type = lookType(b.kind, i.floors, area);
  if (!type) return undefined;
  const p = LOOK_PALETTE[type];
  const id = b.id;
  const shift = i.shift ?? 0;
  let shape: string | undefined;
  let own: readonly string[] = [];
  if (type === 'house' && p.archetypes?.length) {
    const osmShape = b.roofShape;
    const fit = p.archetypes.filter(
      (a) =>
        (!osmShape || !a.roofShape || a.roofShape === osmShape) &&
        (!a.levels || a.levels === Math.min(i.floors, 2) || i.floors > 2),
    );
    const list = fit.length ? fit : p.archetypes;
    const a =
      list[
        weighted(
          list.map((x) => (i.rural ? (x.weightRural ?? x.weight) : x.weight)),
          lookHash(id, 0, 11),
        )
      ]!;
    own = [...(a.walls ?? []), ...(a.roofs ?? [])];
    shape = a.roofShape;
  }
  const wp = pool(type, 'walls', own);
  const rp = pool(type, 'roofs', own);
  const wallSeed =
    type === 'block'
      ? lookHash(
          Math.floor((i.x0 + i.x1) / 2 / ESTATE_CELL),
          Math.floor((i.y0 + i.y1) / 2 / ESTATE_CELL),
          2,
        )
      : lookHash(id, 0, 1);
  const wi = weighted(wp.weights, wallSeed);
  const ri = weighted(rp.weights, lookHash(id, 0, 3));
  // Neighbour rule: a shift walks the roof first, then the wall (blocks keep the estate wall).
  const wallStep = type === 'block' ? 0 : Math.floor(shift / rp.colours.length);
  // Per-building jitter (look-spec: lightness ±6 %, hue ±4°), its own seed; blocks of one
  // estate keep the shared base colour, so they only differ within these bounds.
  const jl = (lookHash(id, 0, 17) * 2 - 1) * 0.06;
  const jh = (lookHash(id, 0, 19) * 2 - 1) * 4;
  const wallColor =
    clampColour(b.colour) ?? jitter(wp.colours[(wi + wallStep) % wp.colours.length]!, jh, jl);
  const roofColor =
    clampColour(b.roofColour) ?? jitter(rp.colours[(ri + shift) % rp.colours.length]!, jh, jl);
  const trimColor = p.trim[Math.floor(lookHash(id, 0, 5) * p.trim.length)] ?? wallColor;
  const shapes = Object.keys(p.roofShapes);
  const roofShape = (
    b.roofShape && SHAPES.has(b.roofShape)
      ? b.roofShape
      : (shape ?? shapes[weighted(Object.values(p.roofShapes), lookHash(id, 0, 7))] ?? 'flat')
  ) as RoofShape;
  const zone = type === 'industrial' ? 'industrial' : i.rural ? 'village' : 'city';
  const cw = CONDITION.weights[zone];
  // look-spec §C placement: rail ×2, industrial land ×2, settlement edge ×1.5, centre ×0.5.
  // ×0.42 keeps the map-wide abandoned + ruin share near the zone weights (placement redistributes).
  const mul =
    0.42 *
    (CONDITION.types[type] ?? 1) *
    (i.nearRail ? 2 : 1) *
    (i.industrialArea ? 2 : 1) *
    (i.rural ? 1.5 : 1) *
    (i.centre ? 0.5 : 1);
  const ws = CONDITION_STATES.map((s) => cw[s] * (s === 'abandoned' || s === 'ruin' ? mul : 1));
  // Own seed, independent of the colour picks.
  const condition =
    b.kind === 'ruin' ? 'ruin' : CONDITION_STATES[weighted(ws, lookHash(id, 0, 13))]!;
  return {
    look: type,
    wallColor,
    roofColor,
    trimColor,
    roofShape,
    condition,
    ...(b.kind === 'church' && b.tall ? { tower: 1 as const } : {}),
    pair: `${wp.colours[(wi + wallStep) % wp.colours.length]}${rp.colours[(ri + shift) % rp.colours.length]}`,
  };
}

/**
 * Hue bucket of `#rrggbb` (same as the Modules ratchet, building-look-variety.test.ts): 12 × 30°,
 * greys (S < 0.12) by lightness thirds.
 */
export function hueBucket(hex: string): string {
  const [h, s, l] = hsl(hex);
  if (s < 0.12) return `grey${Math.min(2, Math.floor(l * 3))}`;
  return `h${Math.floor(h / 30)}`;
}

function hsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d)
    h = ((mx === r ? (g - b) / d : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const hx = (k: number) =>
    Math.max(0, Math.min(255, Math.round((k + m) * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

/** Colour shifted by `dh` degrees of hue and `dl` of lightness (relative). */
export function jitter(hex: string, dh: number, dl: number): string {
  const [h, s, l] = hsl(hex);
  return fromHsl((h + dh + 360) % 360, s, Math.max(0, Math.min(1, l * (1 + dl))));
}

const pools = new Map<string, { colours: string[]; weights: number[] }>();
/**
 * Colour pool of a type with hue-balanced weights: the Designer's weights inside a hue bucket,
 * every bucket the same total (no single hue dominates a map). Houses add the picked archetype's
 * walls / roofs, weighted 3× inside their bucket.
 */
function pool(
  type: LookType,
  key: 'walls' | 'roofs',
  own: readonly string[],
): { colours: string[]; weights: number[] } {
  const k = `${type}:${key}:${own.join()}`;
  const hit = pools.get(k);
  if (hit) return hit;
  const p = LOOK_PALETTE[type];
  const base = new Map<string, number>();
  const list = p[key];
  list.forEach((c, j) =>
    base.set(c, (base.get(c) ?? 0) + (key === 'walls' ? (p.weights[j] ?? 0.1) : 1 / list.length)),
  );
  const avg = 1 / Math.max(1, list.length);
  for (const c of own) base.set(c, (base.get(c) ?? avg) * 3);
  const colours = [...base.keys()];
  const sums = new Map<string, number>();
  for (const c of colours) sums.set(hueBucket(c), (sums.get(hueBucket(c)) ?? 0) + base.get(c)!);
  // Beige (h1) is most of every palette: its bucket weighs 0.8 so it stays under 30 % map-wide.
  const weights = colours.map(
    (c) => (base.get(c)! / sums.get(hueBucket(c))!) * (hueBucket(c) === 'h1' ? 0.8 : 1),
  );
  const out = { colours, weights };
  pools.set(k, out);
  return out;
}

/** Wall + roof pair key (neighbour rule). */
export const lookPair = (l: BuildingLook): string => l.pair;
