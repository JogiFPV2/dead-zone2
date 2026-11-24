import {
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  RGBAFormat,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  Vector2,
  Vector3,
  type MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { rng } from './painted-ground.js';

/**
 * Painted buildings of the „Malowany” style (Paweł 24.11, Project Zomboid as the model): the town
 * kit and the vector walls keep their geometry and palette UVs, the kit material gets painted
 * textures projected along each face in world metres:
 *
 * - outside: plaster, brick, siding, panels, corrugated sheet, planks, roof tiles, roofing felt,
 *   tinted by the palette colour of the building;
 * - inside (the face looks into a room): wallpapers, wall tiles, oil-painted dado („lamperia”),
 *   wooden floors, floor tiles, carpet, terrazzo, by room type, a colour per room.
 *
 * Which room a face looks into comes from `PAINTED_ROOMS` (`world/town/painted-rooms.ts`): a tile
 * texture around the player, one channel per storey, `kind << 4 | variant` per tile (0 = outside).
 * Textures are painted on a canvas at the first switch to the style (other styles and tests paint
 * nothing).
 */

/** Texture layers (index = layer of the array texture). */
export const BLD_LAYERS = [
  'tynk',
  'cegla',
  'siding',
  'plyta',
  'blacha',
  'deski',
  'dachowka',
  'papa',
  'parkiet',
  'plytki',
  'wykladzina',
  'tapeta_paski',
  'tapeta_wzor',
  'kafelki',
  'lastryko',
  'beton',
] as const;
export type BldLayer = (typeof BLD_LAYERS)[number];
const L = Object.fromEntries(BLD_LAYERS.map((n, i) => [n, i])) as Record<BldLayer, number>;

/** Metres per texture repeat. */
export const BLD_TILE: Readonly<Record<BldLayer, number>> = {
  tynk: 3,
  cegla: 1.2,
  siding: 2,
  plyta: 3,
  blacha: 2,
  deski: 2,
  dachowka: 2,
  papa: 4,
  parkiet: 2,
  plytki: 1.2,
  wykladzina: 2,
  tapeta_paski: 1,
  tapeta_wzor: 1,
  kafelki: 0.9,
  lastryko: 2,
  beton: 4,
};

/** Palette cell classes of the lookup (0 = keep the flat palette colour). */
export const CELL_CLASS = {
  none: 0,
  tynk: 1,
  cegla: 2,
  siding: 3,
  plyta: 4,
  blacha: 5,
  deski: 6,
  dachowka: 7,
  papa: 8,
  interior: 9,
  floor: 10,
  /** Door leaves (all doors softly lit so they read from afar, Paweł 24.11). */
  door: 11,
} as const;
type CellClass = (typeof CELL_CLASS)[keyof typeof CELL_CLASS];

/** Class of a palette cell by name (bld v2 cells by their facade detail). */
export function cellClass(name: string, v2Detail?: string): CellClass {
  if (v2Detail !== undefined) {
    const roof = /^v2r/.test(name);
    if (roof) return /tiles|sheet-tile/.test(v2Detail) ? CELL_CLASS.dachowka : CELL_CLASS.papa;
    if (/brick/.test(v2Detail)) return CELL_CLASS.cegla;
    if (v2Detail === 'panel') return CELL_CLASS.plyta;
    if (/corrugated|sheet|metal/.test(v2Detail)) return CELL_CLASS.blacha;
    if (v2Detail === 'planks') return CELL_CLASS.deski;
    return CELL_CLASS.tynk;
  }
  if (/^door-/.test(name)) return CELL_CLASS.door;
  if (/^wall-interior/.test(name)) return CELL_CLASS.interior;
  if (/brick|chimney/.test(name)) return CELL_CLASS.cegla;
  if (/siding/.test(name)) return CELL_CLASS.siding;
  if (/^(plank|plank-dark)$/.test(name)) return CELL_CLASS.deski;
  if (/^corrugated|^rust/.test(name)) return CELL_CLASS.blacha;
  if (/^roof-(a|b|c|d|tile)/.test(name)) return CELL_CLASS.dachowka;
  if (/^roof-/.test(name)) return CELL_CLASS.papa;
  if (/^(wood-floor|carpet|kitchen-tiles|concrete)$/.test(name)) return CELL_CLASS.floor;
  if (/wall|stub|kostka|char|-dark$/.test(name) && !/door|frame|trim|glass/.test(name))
    return CELL_CLASS.tynk;
  return CELL_CLASS.none;
}

/** Lookup data (32 × 32: the palette's 16 × 16 cells and bld v2 quarter cells), row = v. */
export function buildBldLut(
  cells: Readonly<Record<string, { uv: readonly [number, number] }>>,
  v2Detail: ReadonlyMap<string, string> = new Map(),
): Uint8Array {
  const N = 32;
  const lut = new Uint8Array(N * N);
  const clamp = (x: number) => Math.min(N - 1, Math.max(0, x));
  // Whole cells first, quarter cells (bld v2) over them.
  const entries = Object.entries(cells).sort(
    ([a], [b]) => Number(a.startsWith('v2')) - Number(b.startsWith('v2')),
  );
  for (const [name, { uv }] of entries) {
    const sub = name.startsWith('v2');
    const k = cellClass(name, sub ? (v2Detail.get(name) ?? 'plaster') : undefined);
    if (sub) {
      lut[clamp(Math.floor(uv[1] * N)) * N + clamp(Math.floor(uv[0] * N))] = k;
    } else {
      const c = clamp(Math.floor(uv[0] * 16)) * 2;
      const r = clamp(Math.floor(uv[1] * 16)) * 2;
      for (const [dc, dr] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        lut[(r + dr) * N + c + dc] = k;
    }
  }
  return lut;
}

/** Room kinds of the rooms texture (high nibble; 0 = outside). */
export const ROOM_KIND = {
  living: 1,
  bedroom: 2,
  kitchen: 3,
  bathroom: 4,
  hall: 5,
  shop: 6,
  public: 7,
  bare: 8,
  gym: 9,
} as const;

/** Room content id → kind. */
export function roomKind(type: string | undefined): number {
  switch (type) {
    case 'base:room-living-room':
      return ROOM_KIND.living;
    case 'base:room-bedroom':
      return ROOM_KIND.bedroom;
    case 'base:room-kitchen':
      return ROOM_KIND.kitchen;
    case 'base:room-bathroom':
      return ROOM_KIND.bathroom;
    case 'base:room-shop':
    case 'base:room-pharmacy':
    case 'base:room-video-store':
    case 'base:room-bookstore':
    case 'base:room-gun-store':
    case 'base:room-gas-station':
      return ROOM_KIND.shop;
    case 'base:room-office':
    case 'base:room-school':
    case 'base:room-police':
    case 'base:room-hospital':
      return ROOM_KIND.public;
    case 'base:room-garage':
    case 'base:room-warehouse':
    case 'base:room-ruin':
      return ROOM_KIND.bare;
    case 'base:room-gym':
      return ROOM_KIND.gym;
    default:
      return ROOM_KIND.hall;
  }
}

/** Rooms texture side (tiles). */
export const ROOMS_SIZE = 256;

function placeholderArray(): DataArrayTexture {
  const t = new DataArrayTexture(new Uint8Array([128, 128, 128, 0]), 1, 1, 1);
  t.needsUpdate = true;
  return t;
}

function lutTexture(): DataTexture {
  const t = new DataTexture(new Uint8Array(32 * 32), 32, 32, RedFormat);
  t.magFilter = t.minFilter = NearestFilter;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

function roomsTexture(): DataTexture {
  const t = new DataTexture(
    new Uint8Array(ROOMS_SIZE * ROOMS_SIZE * 4),
    ROOMS_SIZE,
    ROOMS_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  t.magFilter = t.minFilter = NearestFilter;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** Uniforms shared by reference by every patched program. */
export const PAINTED_BLD = {
  pbOn: { value: 0 },
  pbTex: { value: placeholderArray() },
  pbLut: { value: lutTexture() },
  pbRooms: { value: roomsTexture() },
  /** World tile of rooms texel (0, 0). */
  pbRoomsAt: { value: new Vector2(-1e6, -1e6) },
  /** Floating origin: world = render + origin. */
  pbOrigin: { value: new Vector3() },
};

let paintedTex = false;

/** Turns the painted buildings on or off (paints the textures on the first call with `on`). */
export function setPaintedBuildings(on: boolean): void {
  PAINTED_BLD.pbOn.value = on ? 1 : 0;
  if (!on || paintedTex || typeof document === 'undefined') return;
  paintedTex = true;
  const old = PAINTED_BLD.pbTex.value;
  PAINTED_BLD.pbTex.value = paintBuildingTextures();
  old.dispose();
}

/** Writes the cell → class lookup of the town palette. */
export function setPaintedBuildingCells(
  cells: Readonly<Record<string, { uv: readonly [number, number] }>>,
  v2Detail?: ReadonlyMap<string, string>,
): void {
  const t = PAINTED_BLD.pbLut.value;
  (t.image.data as Uint8Array).set(buildBldLut(cells, v2Detail));
  t.needsUpdate = true;
}

/** Floating origin of the render (world = render + origin). */
export function setPaintedOrigin(x: number, z: number): void {
  PAINTED_BLD.pbOrigin.value.set(x, 0, z);
}

// ─── Painted textures ─────────────────────────────────────────────────────────────────────────
// Grey detail (RGB, mean ≈ 0.5, ×2 in the shader) and a second mask in alpha (mortar, grout,
// wallpaper pattern, dado line…) that the shader mixes towards a second colour.

const S = 256;
type Ctx = CanvasRenderingContext2D;
type Rand = () => number;
const WRAP = [0, -S, S];

const grey = (v: number, a = 1) => {
  const c = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${c},${c},${c},${a})`;
};

function base(ctx: Ctx, v = 0.5): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = grey(v);
  ctx.fillRect(0, 0, S, S);
}

/** Brush strokes in greys around 0.5 (wrapped). */
function strokes(
  ctx: Ctx,
  r: Rand,
  n: number,
  len: number,
  width: number,
  spread: number,
  alpha: number,
  angle: number | null = null,
): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = angle === null ? r() * Math.PI : angle + (r() - 0.5) * 0.35;
    const l = S * len * (0.5 + r());
    ctx.strokeStyle = grey(0.5 + (r() - 0.5) * 2 * spread);
    ctx.globalAlpha = alpha * (0.5 + r());
    ctx.lineWidth = S * width * (0.5 + r());
    for (const dx of WRAP)
      for (const dy of WRAP) {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l);
        ctx.stroke();
      }
  }
  ctx.globalAlpha = 1;
}

/** Soft blotches (wrapped). */
function blotches(ctx: Ctx, r: Rand, n: number, rad: number, k: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const x = r() * S;
    const y = r() * S;
    const rr = S * rad * (0.4 + r());
    const v = 0.5 + (r() - 0.5) * 2 * k;
    for (const dx of WRAP)
      for (const dy of WRAP) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rr);
        g.addColorStop(0, grey(v, alpha));
        g.addColorStop(1, grey(v, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - rr, y + dy - rr, rr * 2, rr * 2);
      }
  }
}

/** Mask painter: a second canvas whose red channel becomes alpha. */
type MaskFn = (m: Ctx, r: Rand) => void;

/** Rows of rectangular units (bricks, tiles, planks): `rows` × `cols`, row offset `shift`. */
function units(
  ctx: Ctx,
  m: Ctx | undefined,
  r: Rand,
  rows: number,
  cols: number,
  shift: number,
  gap: number,
  jit: number,
  lenJit = 0,
): void {
  const h = S / rows;
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * shift * (S / cols);
    let x = -off;
    while (x < S) {
      const w = (S / cols) * (1 + (r() - 0.5) * 2 * lenJit);
      const v = 0.5 + (r() - 0.5) * 2 * jit;
      ctx.fillStyle = grey(v);
      for (const dx of WRAP) ctx.fillRect(x + dx + gap / 2, row * h + gap / 2, w - gap, h - gap);
      // Painted texture inside one unit: a few dabs.
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = grey(v + (r() - 0.5) * 0.12, 0.5);
        const ux = x + r() * w * 0.7;
        const uy = row * h + r() * h * 0.6;
        for (const dx of WRAP) ctx.fillRect(ux + dx, uy, w * 0.3, h * 0.35);
      }
      if (m) {
        m.fillStyle = '#000';
        for (const dx of WRAP) m.fillRect(x + dx + gap / 2, row * h + gap / 2, w - gap, h - gap);
      }
      x += w;
    }
  }
}

interface Painter {
  paint: (ctx: Ctx, r: Rand) => void;
  mask?: MaskFn;
}

const PAINTERS: Record<BldLayer, Painter> = {
  tynk: {
    paint(ctx, r) {
      base(ctx);
      blotches(ctx, r, 40, 0.18, 0.14, 0.35);
      strokes(ctx, r, 1400, 0.05, 0.025, 0.14, 0.16);
      // Rain streaks under the eaves (vertical, faint).
      strokes(ctx, r, 40, 0.25, 0.008, 0.08, 0.12, Math.PI / 2);
    },
  },
  cegla: {
    paint(ctx, r) {
      base(ctx, 0.5);
      units(ctx, undefined, r, 16, 5, 0.5, 2, 0.13);
      strokes(ctx, r, 300, 0.03, 0.012, 0.08, 0.1);
    },
    mask(m, r) {
      m.fillStyle = '#fff';
      m.fillRect(0, 0, S, S);
      units(m, m, r, 16, 5, 0.5, 2.2, 0);
    },
  },
  siding: {
    paint(ctx, r) {
      base(ctx);
      const rows = 10;
      const h = S / rows;
      for (let i = 0; i < rows; i++) {
        // Board: lit top, shadow line under the lap.
        const g = ctx.createLinearGradient(0, i * h, 0, (i + 1) * h);
        g.addColorStop(0, grey(0.6));
        g.addColorStop(0.85, grey(0.48));
        g.addColorStop(1, grey(0.28));
        ctx.fillStyle = g;
        ctx.fillRect(0, i * h, S, h);
      }
      strokes(ctx, r, 500, 0.12, 0.008, 0.06, 0.15, 0);
    },
  },
  plyta: {
    paint(ctx, r) {
      base(ctx);
      blotches(ctx, r, 30, 0.15, 0.08, 0.3);
      strokes(ctx, r, 600, 0.04, 0.015, 0.07, 0.12);
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = grey(0.5 + (r() - 0.5) * 0.3, 0.6);
        ctx.fillRect(r() * S, r() * S, 1.5, 1.5);
      }
    },
    mask(m) {
      m.fillStyle = '#000';
      m.fillRect(0, 0, S, S);
      m.fillStyle = '#fff';
      m.fillRect(0, 0, S, 3);
      m.fillRect(0, 0, 3, S);
    },
  },
  blacha: {
    paint(ctx, r) {
      base(ctx);
      const n = 20;
      for (let i = 0; i < n; i++) {
        const g = ctx.createLinearGradient((i * S) / n, 0, ((i + 1) * S) / n, 0);
        g.addColorStop(0, grey(0.36));
        g.addColorStop(0.5, grey(0.64));
        g.addColorStop(1, grey(0.36));
        ctx.fillStyle = g;
        ctx.fillRect((i * S) / n, 0, S / n, S);
      }
      blotches(ctx, r, 25, 0.12, 0.15, 0.35);
    },
  },
  deski: {
    paint(ctx, r) {
      base(ctx);
      const n = 13;
      const w = S / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = grey(0.5 + (r() - 0.5) * 0.2);
        ctx.fillRect(i * w, 0, w, S);
        ctx.fillStyle = grey(0.22);
        ctx.fillRect(i * w, 0, 1.5, S);
      }
      strokes(ctx, r, 500, 0.15, 0.005, 0.12, 0.2, Math.PI / 2);
    },
  },
  dachowka: {
    paint(ctx, r) {
      base(ctx);
      const rows = 7;
      const cols = 9;
      const h = S / rows;
      const w = S / cols;
      for (let row = 0; row < rows; row++)
        for (let c = -1; c < cols + 1; c++) {
          const x = c * w + (row % 2) * w * 0.5;
          const v = 0.5 + (r() - 0.5) * 0.22;
          const g = ctx.createLinearGradient(0, row * h, 0, (row + 1) * h);
          g.addColorStop(0, grey(v - 0.16));
          g.addColorStop(0.3, grey(v + 0.06));
          g.addColorStop(1, grey(v - 0.04));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x + 1, row * h);
          ctx.lineTo(x + w - 1, row * h);
          ctx.lineTo(x + w - 1, row * h + h * 0.75);
          ctx.quadraticCurveTo(x + w / 2, (row + 1) * h + 2, x + 1, row * h + h * 0.75);
          ctx.fill();
        }
      strokes(ctx, r, 200, 0.03, 0.01, 0.08, 0.1);
    },
  },
  papa: {
    paint(ctx, r) {
      base(ctx);
      blotches(ctx, r, 40, 0.2, 0.12, 0.35);
      for (let i = 0; i < 2500; i++) {
        ctx.fillStyle = grey(0.5 + (r() - 0.5) * 0.4, 0.5);
        ctx.fillRect(r() * S, r() * S, 1.5, 1.5);
      }
      // Seams of the felt strips.
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = grey(0.35, 0.8);
        ctx.fillRect(0, (i * S) / 4, S, 2);
      }
    },
  },
  parkiet: {
    paint(ctx, r) {
      base(ctx);
      units(ctx, undefined, r, 13, 2, 0.37, 1.2, 0.12, 0.2);
      strokes(ctx, r, 700, 0.12, 0.004, 0.14, 0.25, 0);
    },
    mask(m, r) {
      m.fillStyle = '#fff';
      m.fillRect(0, 0, S, S);
      units(m, m, r, 13, 2, 0.37, 1.4, 0, 0.2);
    },
  },
  plytki: {
    paint(ctx, r) {
      base(ctx);
      units(ctx, undefined, r, 4, 4, 0, 3, 0.05);
      blotches(ctx, r, 12, 0.15, 0.05, 0.2);
    },
    mask(m, r) {
      m.fillStyle = '#fff';
      m.fillRect(0, 0, S, S);
      units(m, m, r, 4, 4, 0, 3.5, 0);
    },
  },
  wykladzina: {
    paint(ctx, r) {
      base(ctx);
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = grey(0.5 + (r() - 0.5) * 0.35, 0.45);
        ctx.fillRect(r() * S, r() * S, 1.6, 1.6);
      }
      blotches(ctx, r, 20, 0.15, 0.07, 0.25);
    },
  },
  tapeta_paski: {
    paint(ctx, r) {
      base(ctx);
      strokes(ctx, r, 300, 0.2, 0.01, 0.05, 0.1, Math.PI / 2);
    },
    mask(m) {
      m.fillStyle = '#000';
      m.fillRect(0, 0, S, S);
      m.fillStyle = '#fff';
      for (let i = 0; i < 8; i++) {
        m.fillRect((i * S) / 8, 0, S / 20, S);
        m.globalAlpha = 0.5;
        m.fillRect((i * S) / 8 + S / 14, 0, 2, S);
        m.globalAlpha = 1;
      }
    },
  },
  tapeta_wzor: {
    paint(ctx, r) {
      base(ctx);
      strokes(ctx, r, 200, 0.1, 0.01, 0.05, 0.1);
    },
    mask(m, r) {
      m.fillStyle = '#000';
      m.fillRect(0, 0, S, S);
      m.fillStyle = '#fff';
      // Small flowers in a half-drop repeat.
      const n = 4;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const cx = ((i + 0.5) * S) / n;
          const cy = ((j + 0.5 + (i % 2) * 0.5) * S) / n;
          for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2 + r() * 0.2;
            for (const dy of WRAP) {
              m.beginPath();
              m.ellipse(cx + Math.cos(a) * 7, cy + dy + Math.sin(a) * 7, 6, 3.5, a, 0, Math.PI * 2);
              m.fill();
            }
          }
          m.globalAlpha = 0.55;
          for (const dy of WRAP) {
            m.beginPath();
            m.moveTo(cx, cy + dy + 8);
            m.quadraticCurveTo(cx + 14, cy + dy + 20, cx + 6, cy + dy + 30);
            m.lineWidth = 2;
            m.strokeStyle = '#fff';
            m.stroke();
          }
          m.globalAlpha = 1;
        }
    },
  },
  kafelki: {
    paint(ctx, r) {
      base(ctx);
      units(ctx, undefined, r, 6, 6, 0, 2, 0.04);
      // Glaze highlights.
      strokes(ctx, r, 60, 0.03, 0.01, 0.2, 0.15, Math.PI / 4);
    },
    mask(m, r) {
      m.fillStyle = '#fff';
      m.fillRect(0, 0, S, S);
      units(m, m, r, 6, 6, 0, 2.4, 0);
    },
  },
  lastryko: {
    paint(ctx, r) {
      base(ctx);
      for (let i = 0; i < 3500; i++) {
        ctx.fillStyle = grey(0.5 + (r() - 0.5) * 0.6, 0.7);
        const s = 1 + r() * 3;
        ctx.fillRect(r() * S, r() * S, s, s * (0.6 + r() * 0.6));
      }
    },
    mask(m) {
      m.fillStyle = '#000';
      m.fillRect(0, 0, S, S);
      m.fillStyle = '#fff';
      m.fillRect(0, 0, S, 2);
      m.fillRect(0, 0, 2, S);
    },
  },
  beton: {
    paint(ctx, r) {
      base(ctx);
      blotches(ctx, r, 50, 0.16, 0.1, 0.35);
      for (let i = 0; i < 1500; i++) {
        ctx.fillStyle = grey(0.5 + (r() - 0.5) * 0.4, 0.5);
        ctx.fillRect(r() * S, r() * S, 1.4, 1.4);
      }
    },
  },
};

/** Paints every layer into one RGBA array texture (mipmapped, repeat). */
export function paintBuildingTextures(): DataArrayTexture {
  const data = new Uint8Array(S * S * 4 * BLD_LAYERS.length);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const mc = document.createElement('canvas');
  mc.width = mc.height = S;
  const m = mc.getContext('2d', { willReadFrequently: true })!;
  BLD_LAYERS.forEach((name, i) => {
    const p = PAINTERS[name];
    ctx.clearRect(0, 0, S, S);
    p.paint(ctx, rng(101 + i * 977));
    const rgb = ctx.getImageData(0, 0, S, S).data;
    let a: Uint8ClampedArray | undefined;
    if (p.mask) {
      m.globalAlpha = 1;
      m.clearRect(0, 0, S, S);
      p.mask(m, rng(101 + i * 977));
      a = m.getImageData(0, 0, S, S).data;
    }
    const off = i * S * S * 4;
    for (let k = 0; k < S * S; k++) {
      data[off + k * 4] = rgb[k * 4]!;
      data[off + k * 4 + 1] = rgb[k * 4 + 1]!;
      data[off + k * 4 + 2] = rgb[k * 4 + 2]!;
      data[off + k * 4 + 3] = a ? a[k * 4]! : 0;
    }
  });
  const t = new DataArrayTexture(data, S, S, BLD_LAYERS.length);
  t.format = RGBAFormat;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// ─── Shader ───────────────────────────────────────────────────────────────────────────────────

const tileArr = `float pbTile[${BLD_LAYERS.length}] = float[](${BLD_LAYERS.map((n) => BLD_TILE[n].toFixed(2)).join(', ')});`;

/** Fragment declarations (after `#include <common>`): uniforms and helpers. */
export const PAINTED_BLD_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform float pbOn;
uniform sampler2DArray pbTex;
uniform sampler2D pbLut;
uniform sampler2D pbRooms;
uniform vec2 pbRoomsAt;
uniform vec3 pbOrigin;
${tileArr}
// Room code (kind << 4 | variant) at world (x, z) on storey z (0 = outside or unknown).
int pbRoom(vec2 p, float y) {
  ivec2 t = ivec2(floor(p - pbRoomsAt));
  if (t.x < 0 || t.y < 0 || t.x >= ${ROOMS_SIZE} || t.y >= ${ROOMS_SIZE}) return 0;
  vec4 c = texelFetch(pbRooms, t, 0);
  int lv = int(clamp(floor((y + 0.15) / 3.0), 0.0, 3.0));
  float v = lv == 0 ? c.r : lv == 1 ? c.g : lv == 2 ? c.b : c.a;
  return int(v * 255.0 + 0.5);
}
// Room code for a floor at (x, z): its own, else the nearest room within 2 tiles (the strip of a
// slanted building between its rooms and the outline wall has no room of its own).
int pbRoomFloor(vec2 p, float y) {
  int r = pbRoom(p, y);
  if (r > 0) return r;
  for (int d = 1; d <= 2; d++)
    for (int i = -d; i <= d; i++)
      for (int k = 0; k < 4; k++) {
        vec2 o = k == 0 ? vec2(i, -d) : k == 1 ? vec2(i, d) : k == 2 ? vec2(-d, i) : vec2(d, i);
        int q = pbRoom(p + o, y);
        if (q > 0) return q;
      }
  return 0;
}
vec4 pbSample(float layer, vec2 uv) {
  return texture(pbTex, vec3(uv / pbTile[int(layer)], layer));
}
// Hash of a room variant → 0..1.
float pbH(int v, float salt) { return fract(sin(float(v) * 12.9898 + salt * 78.233) * 43758.5453); }
vec3 pbPick4(int v, float salt, vec3 a, vec3 b, vec3 c, vec3 d) {
  int i = int(pbH(v, salt) * 4.0);
  return i == 0 ? a : i == 1 ? b : i == 2 ? c : d;
}
vec3 pbLin(vec3 srgb) { return pow(srgb, vec3(2.2)); }
// Interior wall of a room: wallpapers, tiles, dado. y = height above the storey floor.
vec3 pbWall(int code, vec2 uv, float y) {
  int kind = code >> 4;
  int v = code & 15;
  if (kind == ${ROOM_KIND.bathroom} || (kind == ${ROOM_KIND.kitchen} && y < 1.5)) {
    vec4 t = pbSample(${L.kafelki}.0, uv);
    vec3 tile = pbPick4(v, 1.0, vec3(0.86, 0.86, 0.82), vec3(0.62, 0.76, 0.80), vec3(0.70, 0.78, 0.62), vec3(0.85, 0.80, 0.66));
    if (y > 2.0 && kind == ${ROOM_KIND.bathroom}) return pbLin(vec3(0.9, 0.88, 0.82)) * t.rgb * 2.0;
    return pbLin(mix(tile, vec3(0.75), t.a * 0.8)) * t.rgb * 2.0;
  }
  if (kind == ${ROOM_KIND.public} || kind == ${ROOM_KIND.shop} || kind == ${ROOM_KIND.hall} || kind == ${ROOM_KIND.gym}) {
    vec4 t = pbSample(${L.tynk}.0, uv);
    vec3 up = pbPick4(v, 2.0, vec3(0.88, 0.86, 0.78), vec3(0.85, 0.85, 0.82), vec3(0.86, 0.82, 0.70), vec3(0.80, 0.84, 0.80));
    vec3 lo = pbPick4(v, 3.0, vec3(0.38, 0.55, 0.45), vec3(0.42, 0.50, 0.62), vec3(0.58, 0.42, 0.34), vec3(0.70, 0.64, 0.50));
    float dado = kind == ${ROOM_KIND.shop} ? 0.0 : step(y, 1.35);
    vec3 c = mix(up, lo, dado);
    c = mix(c, c * 0.7, (1.0 - smoothstep(0.0, 0.02, abs(y - 1.35))) * dado);
    return pbLin(c) * mix(1.0, t.r * 2.0, 0.5);
  }
  if (kind == ${ROOM_KIND.bare}) {
    vec4 t = pbSample(${L.beton}.0, uv);
    return pbLin(vec3(0.62, 0.61, 0.58)) * t.rgb * 2.0;
  }
  // Homes: wallpaper (stripes or flowers), a colour per room.
  bool flowers = pbH(v, 4.0) > 0.5;
  vec4 t = pbSample(flowers ? ${L.tapeta_wzor}.0 : ${L.tapeta_paski}.0, uv);
  vec3 bg = pbPick4(v, 5.0, vec3(0.84, 0.78, 0.62), vec3(0.66, 0.74, 0.62), vec3(0.80, 0.66, 0.62), vec3(0.64, 0.70, 0.78));
  if (kind == ${ROOM_KIND.bedroom}) bg = pbPick4(v, 6.0, vec3(0.80, 0.70, 0.72), vec3(0.70, 0.72, 0.82), vec3(0.86, 0.82, 0.70), vec3(0.72, 0.80, 0.74));
  vec3 fg = bg * vec3(0.80, 0.78, 0.76) + vec3(0.06, 0.04, 0.02);
  if (pbH(v, 7.0) > 0.6) fg = bg * 1.12;
  vec3 c = mix(bg, fg, t.a);
  // Skirting board.
  if (y < 0.09) c = vec3(0.38, 0.27, 0.18);
  return pbLin(c) * t.rgb * 2.0;
}
// Floor of a room.
vec3 pbFloor(int code, vec2 uv) {
  int kind = code >> 4;
  int v = code & 15;
  if (kind == ${ROOM_KIND.kitchen} || kind == ${ROOM_KIND.bathroom}) {
    vec4 t = pbSample(${L.plytki}.0, uv);
    vec3 a = pbPick4(v, 8.0, vec3(0.78, 0.76, 0.70), vec3(0.55, 0.42, 0.33), vec3(0.62, 0.64, 0.66), vec3(0.74, 0.66, 0.52));
    // Checkerboard in some kitchens.
    vec2 cell = floor(uv / 0.3);
    if (kind == ${ROOM_KIND.kitchen} && pbH(v, 9.0) > 0.6 && mod(cell.x + cell.y, 2.0) > 0.5) a = vec3(0.22, 0.22, 0.24);
    return pbLin(mix(a, vec3(0.45), t.a * 0.85)) * t.rgb * 2.0;
  }
  if (kind == ${ROOM_KIND.bedroom} && pbH(v, 10.0) > 0.4) {
    vec4 t = pbSample(${L.wykladzina}.0, uv);
    vec3 a = pbPick4(v, 11.0, vec3(0.45, 0.20, 0.20), vec3(0.30, 0.38, 0.28), vec3(0.40, 0.42, 0.50), vec3(0.55, 0.46, 0.36));
    return pbLin(a) * t.rgb * 2.0;
  }
  if (kind == ${ROOM_KIND.public} || kind == ${ROOM_KIND.shop} || kind == ${ROOM_KIND.hall}) {
    vec4 t = pbSample(${L.lastryko}.0, uv);
    vec3 a = pbPick4(v, 12.0, vec3(0.70, 0.68, 0.64), vec3(0.60, 0.55, 0.50), vec3(0.62, 0.64, 0.60), vec3(0.72, 0.62, 0.52));
    return pbLin(mix(a, a * 0.75, t.a)) * t.rgb * 2.0;
  }
  if (kind == ${ROOM_KIND.bare}) {
    vec4 t = pbSample(${L.beton}.0, uv);
    return pbLin(vec3(0.55, 0.54, 0.52)) * t.rgb * 2.0;
  }
  vec4 t = pbSample(${L.parkiet}.0, uv);
  vec3 a = pbPick4(v, 13.0, vec3(0.62, 0.42, 0.26), vec3(0.72, 0.54, 0.34), vec3(0.50, 0.33, 0.21), vec3(0.78, 0.62, 0.42));
  return pbLin(mix(a, a * 0.55, t.a)) * t.rgb * 2.0;
}
// Outside: palette colour × texture of the cell class.
vec3 pbOutside(int cls, vec3 pal, vec2 uv, vec2 roofUv, bool up) {
  float layer = cls == ${CELL_CLASS.cegla} ? ${L.cegla}.0 : cls == ${CELL_CLASS.siding} ? ${L.siding}.0
    : cls == ${CELL_CLASS.plyta} ? ${L.plyta}.0 : cls == ${CELL_CLASS.blacha} ? ${L.blacha}.0
    : cls == ${CELL_CLASS.deski} ? ${L.deski}.0 : cls == ${CELL_CLASS.dachowka} ? ${L.dachowka}.0
    : cls == ${CELL_CLASS.papa} ? ${L.papa}.0 : ${L.tynk}.0;
  bool roof = cls == ${CELL_CLASS.dachowka} || cls == ${CELL_CLASS.papa};
  vec4 t = pbSample(layer, roof && !up ? roofUv : uv);
  // Lift the dark, night-tuned palette into the painted range (a little desaturated); mortar /
  // joints towards a light grey.
  float lum = dot(pal, vec3(0.2126, 0.7152, 0.0722));
  vec3 c = min(mix(pal, vec3(lum), 0.2) * 2.4, vec3(0.8));
  if (cls == ${CELL_CLASS.cegla}) c = mix(c, vec3(0.42, 0.40, 0.36), t.a * 0.85);
  if (cls == ${CELL_CLASS.plyta}) c = mix(c, c * 0.55, t.a);
  return c * t.rgb * 2.0;
}
// Plinth, splash dirt and soft weathering of a facade (y = height above the ground).
vec3 pbWeather(vec3 c, vec2 uv, float y) {
  vec4 n = pbSample(${L.beton}.0, uv * 0.35);
  if (y < 0.45) c = mix(c, vec3(0.16, 0.15, 0.14) * n.r * 2.0, 0.75);
  else c *= mix(0.82, 1.0, smoothstep(0.45, 1.1, y));
  return c * mix(1.0, n.r * 2.0, 0.35);
}
`;

/** Vertex declarations (after `#include <common>`). */
export const PAINTED_BLD_VERT_PARS = 'varying vec3 vPbW;\nvarying vec3 vPbN;\n';

/** Vertex body (after `#include <worldpos_vertex>`): world position and normal. */
export const PAINTED_BLD_VERT = /* glsl */ `
{
  vec4 pbP = vec4(transformed, 1.0);
  vec3 pbN = objectNormal;
#ifdef USE_BATCHING
  pbP = batchingMatrix * pbP; pbN = mat3(batchingMatrix) * pbN;
#endif
#ifdef USE_INSTANCING
  pbP = instanceMatrix * pbP; pbN = mat3(instanceMatrix) * pbN;
#endif
  vPbW = (modelMatrix * pbP).xyz;
  vPbN = mat3(modelMatrix) * pbN;
}
`;

/**
 * Blue of the batch colour that marks a door leaf instance (`openings.ts` sets it with red and
 * green 1): the leaf glows softly in the painted style; the colour itself is unchanged to the eye.
 */
export const DOOR_MARK_B = 0.998;

/** Door leaves: share of their colour added as glow (plus a faint warm light). */
export const PB_DOOR_GLOW = 0.6;

/** Share of the facade colour added as fill light on painted outside walls. */
export const PB_FILL = 0.4;

/** Kit fragment (after `#include <map_fragment>`). */
export const PAINTED_BLD_FRAG = /* glsl */ `
vec3 pbFill = vec3(0.0);
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
bool pbDoor = vColor.r > 0.9995 && abs(vColor.b - ${DOOR_MARK_B}) < 0.0006;
#else
bool pbDoor = false;
#endif
if (pbOn > 0.5 && pbDoor) {
  // Door leaf (instance marked by openings.ts): soft warm glow so doors read from afar.
  pbFill = diffuseColor.rgb * ${PB_DOOR_GLOW.toFixed(3)} + vec3(1.0, 0.72, 0.4) * 0.05;
} else if (pbOn > 0.5) {
  int cls = int(texture2D(pbLut, vMapUv).r * 255.0 + 0.5);
  if (cls == ${CELL_CLASS.door}) {
    // Door leaf: its palette colour with painted grain and a soft warm glow.
    vec3 W = vPbW + pbOrigin;
    vec3 pal = texture2D(map, vMapUv).rgb;
    vec4 t = pbSample(${L.deski}.0, vec2(W.x + W.z, W.y) * 0.7);
    diffuseColor.rgb = min(pal * 1.6, vec3(0.85)) * mix(1.0, t.r * 2.0, 0.5);
    pbFill = diffuseColor.rgb * ${PB_DOOR_GLOW.toFixed(3)} + vec3(1.0, 0.72, 0.4) * 0.05;
  } else if (cls > 0) {
    vec3 W = vPbW + pbOrigin;
    // Face normal from the derivatives (flat shading; instance scale does not matter).
    vec3 n = normalize(cross(dFdx(vPbW), dFdy(vPbW)));
    if (dot(n, vPbN) < 0.0) n = -n;
    vec3 pal = texture2D(map, vMapUv).rgb;
    bool up = n.y > 0.7;
    vec2 h = normalize(n.xz + vec2(1e-5));
    vec2 tang = vec2(-h.y, h.x);
    vec2 wallUv = vec2(dot(W.xz, tang), W.y);
    vec2 roofUv = vec2(dot(W.xz, tang), -dot(W.xz, h) * 1.3);
    float lvY = W.y - floor((W.y + 0.15) / 3.0) * 3.0;
    if (up && cls == ${CELL_CLASS.floor}) {
      int room = pbRoomFloor(W.xz - n.xz * 0.05, W.y);
      if (room > 0) diffuseColor.rgb = pbFloor(room, W.xz);
    } else if (abs(n.y) < 0.3 && cls != ${CELL_CLASS.dachowka} && cls != ${CELL_CLASS.papa}) {
      int near = pbRoom(W.xz + n.xz * 0.4, W.y);
      int far = pbRoom(W.xz + n.xz * 1.2, W.y);
      int room = near > 0 ? near : far;
      if (far > 0 || (cls == ${CELL_CLASS.interior} && room > 0)) diffuseColor.rgb = pbWall(room, wallUv, lvY);
      else if (cls == ${CELL_CLASS.interior}) diffuseColor.rgb = pbOutside(${CELL_CLASS.tynk}, vec3(0.62, 0.6, 0.56), wallUv, roofUv, up);
      else if (cls != ${CELL_CLASS.floor}) {
        diffuseColor.rgb = pbWeather(pbOutside(cls, pal, wallUv, roofUv, up), wallUv, W.y);
        // Soft fill: facades away from the sun still read in their colour (Project Zomboid look).
        pbFill = diffuseColor.rgb * ${PB_FILL.toFixed(3)};
      }
    } else if (cls != ${CELL_CLASS.floor} && cls != ${CELL_CLASS.interior}) {
      diffuseColor.rgb = pbOutside(cls, pal, up ? W.xz : wallUv, roofUv, up);
    }
  }
}
`;

/** Patches the town kit material (and through it the vector walls' fade clones). */
export function withPaintedBuildings(m: MeshStandardMaterial): MeshStandardMaterial {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r) => {
    prev(sh, r);
    patchPaintedBuildings(sh);
  };
  m.customProgramCacheKey = () => `${prevKey()}|dz-painted-bld`;
  return m;
}

export function patchPaintedBuildings(sh: WebGLProgramParametersWithUniforms): void {
  Object.assign(sh.uniforms, PAINTED_BLD);
  if (!sh.vertexShader.includes('vPbW')) {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${PAINTED_BLD_VERT_PARS}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${PAINTED_BLD_VERT}`);
  }
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${PAINTED_BLD_VERT_PARS}${PAINTED_BLD_PARS}`)
    .replace('#include <map_fragment>', `#include <map_fragment>\n${PAINTED_BLD_FRAG}`)
    .replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += pbFill;',
    );
}
