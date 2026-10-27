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
  let walls = p.walls;
  let wallWeights = p.weights;
  let roofs = p.roofs;
  let shape: string | undefined;
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
    if (a.walls?.length) {
      walls = a.walls;
      wallWeights = a.walls.map(() => 1);
    }
    if (a.roofs?.length) roofs = a.roofs;
    shape = a.roofShape;
  }
  const wallSeed =
    type === 'block'
      ? lookHash(
          Math.floor((i.x0 + i.x1) / 2 / ESTATE_CELL),
          Math.floor((i.y0 + i.y1) / 2 / ESTATE_CELL),
          2,
        )
      : lookHash(id, 0, 1);
  const wi = weighted(wallWeights, wallSeed);
  const ri = Math.floor(lookHash(id, 0, 3) * roofs.length);
  // Neighbour rule: a shift walks the roof first, then the wall (blocks keep the estate wall).
  const wallColor =
    clampColour(b.colour) ??
    walls[(wi + (type === 'block' ? 0 : Math.floor(shift / roofs.length))) % walls.length]!;
  const roofColor = clampColour(b.roofColour) ?? roofs[(ri + shift) % roofs.length]!;
  const trimColor = p.trim[Math.floor(lookHash(id, 0, 5) * p.trim.length)] ?? wallColor;
  const shapes = Object.keys(p.roofShapes);
  const roofShape = (
    b.roofShape && SHAPES.has(b.roofShape)
      ? b.roofShape
      : (shape ?? shapes[weighted(Object.values(p.roofShapes), lookHash(id, 0, 7))] ?? 'flat')
  ) as RoofShape;
  const zone = type === 'industrial' ? 'industrial' : i.rural ? 'village' : 'city';
  const cw = CONDITION.weights[zone];
  const mul = CONDITION.types[type] ?? 1;
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
  };
}

/** Wall + roof pair key (neighbour rule). */
export const lookPair = (l: BuildingLook): string => `${l.wallColor}${l.roofColor}`;
