import type { BufferGeometry } from 'three';
import type { TownCells } from './kit.js';
import { Builder } from './levels.js';

/**
 * Door leaves and window sashes built from boxes in palette cells (Paweł 24.11: „drzwi powinny
 * mieć swój model i grafikę i wyglądać jak drzwi”). Replace the flat slabs of the town GLB:
 * stiles and rails around recessed panels, glazing, a lever handle with its plate on both faces,
 * hinges, a kick plate on outside doors. Pure (tests): only the palette cells are needed.
 *
 * Door leaf frame (same as the GLB leaves, see `kitOpeningMatrix`): hinge at the origin, the
 * closed leaf along +x (0 … LEAF.width), y up from the floor, centred on z (wall line).
 */
export const LEAF = { width: 0.84, height: 2.06, thick: 0.05 } as const;

/** Leaf looks by GLB name (`doorLeaf` in modules.ts picks one per building skin). */
export type LeafLook = 'door-wood' | 'door-red' | 'door-green' | 'door-glass';
export const LEAF_LOOKS: readonly LeafLook[] = [
  'door-wood',
  'door-red',
  'door-green',
  'door-glass',
];

/** Stile (vertical frame member) and rail widths of a panelled leaf (m). */
const STILE = 0.11;
const RAIL = 0.12;
/** Depth of the recessed panels below the stile face (m). */
const RECESS = 0.014;
/** Handle: height above the floor, distance of the lever plate from the free edge. */
export const HANDLE_Y = 1.02;
const HANDLE_IN = 0.075;

interface Look {
  /** Stiles and rails. */
  face: string;
  /** Recessed panels. */
  panel: string;
  /** Panel rows (y0, y1) of the leaf; `glass` rows are glazed. */
  rows: { y0: number; y1: number; glass?: boolean; grid?: boolean }[];
  /** Kick plate on the lower rail (outside doors). */
  kick?: boolean;
  /** Vertical grooves on the panels (board door). */
  grooves?: boolean;
  /** Aluminium shop door: thin metal frame, push bar instead of a lever. */
  shop?: boolean;
}

const H = LEAF.height;
const LOOKS: Record<LeafLook, Look> = {
  // Interior PRL door: a glazed top (frosted glass) and two panels below.
  'door-wood': {
    face: 'door-wood',
    panel: 'door-wood-dark',
    rows: [
      { y0: RAIL, y1: 0.86 },
      { y0: 0.86 + RAIL, y1: 1.32 },
      { y0: 1.32 + RAIL * 0.8, y1: H - RAIL, glass: true },
    ],
  },
  // House front door: vertical boards, small window up top, kick plate.
  'door-red': {
    face: 'door-red',
    panel: 'door-red-dark',
    rows: [
      { y0: RAIL * 1.6, y1: 1.5, grid: false },
      { y0: 1.5 + RAIL * 0.8, y1: H - RAIL, glass: true, grid: true },
    ],
    kick: true,
    grooves: true,
  },
  // Steel block / service door: a wired glass pane and one big panel.
  'door-green': {
    face: 'door-green',
    panel: 'door-green-dark',
    rows: [
      { y0: RAIL * 1.6, y1: 1.12 },
      { y0: 1.12 + RAIL, y1: H - RAIL * 1.3, glass: true, grid: true },
    ],
    kick: true,
  },
  // Shop / office door: aluminium frame, full glass, push bar.
  'door-glass': {
    face: 'frame-dark',
    panel: 'frame-dark',
    rows: [{ y0: 0.3, y1: H - 0.09, glass: true }],
    shop: true,
  },
};

/** Door leaf geometry of a look (see the frame above). */
export function doorLeafGeometry(cells: TownCells, look: LeafLook): BufferGeometry {
  const L = LOOKS[look];
  const g = new Builder(cells);
  const W = LEAF.width;
  const t = LEAF.thick / 2;
  const stile = L.shop ? 0.07 : STILE;
  // Core slab (panels' back) of every unglazed row, recessed on both faces.
  for (const r of L.rows)
    if (!r.glass)
      g.box(
        stile - 0.01,
        r.y0,
        -(t - RECESS),
        W - stile + 0.01,
        r.y1,
        t - RECESS,
        L.panel,
        L.panel,
      );
  // Stiles (full height) and rails between / around the panel rows.
  g.box(0, 0, -t, stile, H, t, L.face, L.face);
  g.box(W - stile, 0, -t, W, H, t, L.face, L.face);
  const rows = L.rows;
  let y = 0;
  for (const r of rows) {
    if (r.y0 - y > 1e-3) g.box(stile, y, -t, W - stile, r.y0, t, L.face, L.face);
    y = r.y1;
  }
  if (H - y > 1e-3) g.box(stile, y, -t, W - stile, H, t, L.face, L.face);
  for (const r of rows) {
    const x0 = stile;
    const x1 = W - stile;
    if (r.glass) {
      // Pane in the middle of the leaf (thin, both faces) + glazing beads.
      g.box(x0, r.y0, -0.006, x1, r.y1, 0.006, 'glass', 'glass');
      const bead = 0.02;
      for (const s of [-1, 1]) {
        const z0 = s < 0 ? -t + RECESS * 0.5 : 0.006;
        const z1 = s < 0 ? -0.006 : t - RECESS * 0.5;
        g.box(x0, r.y0, z0, x1, r.y0 + bead, z1, L.face, L.face);
        g.box(x0, r.y1 - bead, z0, x1, r.y1, z1, L.face, L.face);
        g.box(x0, r.y0, z0, x0 + bead, r.y1, z1, L.face, L.face);
        g.box(x1 - bead, r.y0, z0, x1, r.y1, z1, L.face, L.face);
      }
      if (r.grid) {
        // Wired / divided glass: one cross bar.
        const mx = (x0 + x1) / 2;
        const my = (r.y0 + r.y1) / 2;
        g.box(mx - 0.012, r.y0, -0.012, mx + 0.012, r.y1, 0.012, L.face, L.face);
        g.box(x0, my - 0.012, -0.012, x1, my + 0.012, 0.012, L.face, L.face);
      }
    } else if (L.grooves) {
      // Board door: raised boards with dark joints (every ~12 cm).
      const n = Math.max(2, Math.round((x1 - x0) / 0.125));
      const w = (x1 - x0) / n;
      for (let i = 0; i < n; i++) {
        const a = x0 + i * w + 0.008;
        const b = x0 + (i + 1) * w - 0.008;
        g.box(a, r.y0, -t + RECESS * 0.35, b, r.y1, t - RECESS * 0.35, L.face, L.face);
      }
    } else {
      // Raised field in the middle of the recessed panel (a bevelled „płycina”).
      const m = 0.045;
      if (r.y1 - r.y0 > 2 * m + 0.05)
        g.box(
          x0 + m,
          r.y0 + m,
          -t + RECESS * 0.45,
          x1 - m,
          r.y1 - m,
          t - RECESS * 0.45,
          L.face,
          L.face,
        );
    }
  }
  if (L.kick)
    g.box(stile * 0.5, 0.02, -t - 0.004, W - stile * 0.5, 0.2, t + 0.004, 'metal', 'metal');
  // Hinges: two knuckles on the hinge edge.
  for (const hy of [0.22, H - 0.34])
    g.box(-0.018, hy, -0.018, 0.006, hy + 0.12, 0.018, 'frame-dark', 'frame-dark');
  if (L.shop) {
    // Horizontal push bar across the glass on both faces.
    for (const s of [-1, 1]) {
      const z0 = s < 0 ? -t - 0.05 : t + 0.03;
      g.box(0.12, HANDLE_Y - 0.02, z0, W - 0.12, HANDLE_Y + 0.02, z0 + 0.02, 'metal', 'metal');
      for (const x of [0.14, W - 0.16])
        g.box(
          x,
          HANDLE_Y - 0.02,
          s < 0 ? -t - 0.03 : t,
          x + 0.02,
          HANDLE_Y + 0.02,
          s < 0 ? -t : t + 0.03,
          'metal',
          'metal',
        );
    }
    return g.geometry();
  }
  // Lever handle on both faces: tall plate with the keyhole below, lever pointing to the hinge.
  const hx = W - HANDLE_IN;
  for (const s of [-1, 1]) {
    const zf = s < 0 ? -t : t;
    const z0 = s < 0 ? zf - 0.008 : zf;
    const z1 = s < 0 ? zf : zf + 0.008;
    g.box(
      hx - 0.03,
      HANDLE_Y - 0.16,
      z0,
      hx + 0.03,
      HANDLE_Y + 0.06,
      z1,
      'frame-dark',
      'frame-dark',
    );
    g.box(
      hx - 0.01,
      HANDLE_Y - 0.12,
      z0 - 0.002 * -s,
      hx + 0.01,
      HANDLE_Y - 0.08,
      z1 + 0.002 * s,
      'metal',
      'metal',
    );
    // Neck out of the plate, then the lever towards the hinge side.
    const n0 = s < 0 ? zf - 0.055 : zf + 0.008;
    const n1 = s < 0 ? zf - 0.008 : zf + 0.055;
    g.box(hx - 0.012, HANDLE_Y - 0.012, n0, hx + 0.012, HANDLE_Y + 0.012, n1, 'metal', 'metal');
    const l0 = s < 0 ? zf - 0.068 : zf + 0.04;
    const l1 = s < 0 ? zf - 0.04 : zf + 0.068;
    g.box(
      hx - 0.15,
      HANDLE_Y - 0.02,
      l0,
      hx + 0.015,
      HANDLE_Y + 0.02,
      l1,
      'frame-dark',
      'frame-dark',
    );
  }
  return g.geometry();
}

/**
 * Casement sash of an opened window (the glass of the wall module is hidden then, see
 * `edgeModule` `open`): hinge at the origin, closed along +x (0 … width), from `y0` to `y1`
 * above the floor, centred on z. Frame in `frame` cell, a mullion-less pane.
 */
export function windowSashGeometry(
  cells: TownCells,
  width: number,
  y0: number,
  y1: number,
  frame = 'trim-light',
): BufferGeometry {
  const g = new Builder(cells);
  const f = 0.055;
  const t = 0.03;
  g.box(0, y0, -t, f, y1, t, frame, frame);
  g.box(width - f, y0, -t, width, y1, t, frame, frame);
  g.box(f, y0, -t, width - f, y0 + f, t, frame, frame);
  g.box(f, y1 - f, -t, width - f, y1, t, frame, frame);
  g.box(f, y0 + f, -0.006, width - f, y1 - f, 0.006, 'glass', 'glass');
  // Small handle on the free edge.
  const hy = (y0 + y1) / 2;
  g.box(width - f - 0.02, hy - 0.06, t, width - f, hy + 0.02, t + 0.03, 'metal', 'metal');
  return g.geometry();
}

/** Glass of a window module: lowest / highest y and half width of its `glass` triangles. */
export function glassBounds(
  geo: BufferGeometry,
  uv: readonly [number, number],
  cell = 1 / 16,
): { y0: number; y1: number; half: number } | undefined {
  const pos = geo.getAttribute('position');
  const tex = geo.getAttribute('uv');
  if (!tex) return undefined;
  let y0 = Infinity;
  let y1 = -Infinity;
  let half = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(tex.getX(i) - uv[0]) >= cell / 2 || Math.abs(tex.getY(i) - uv[1]) >= cell / 2)
      continue;
    y0 = Math.min(y0, pos.getY(i));
    y1 = Math.max(y1, pos.getY(i));
    half = Math.max(half, Math.abs(pos.getX(i)));
  }
  return Number.isFinite(y0) && y1 > y0 ? { y0, y1, half } : undefined;
}

/** Kit name of the opened-window sash for a window module (`window-sash`, shop: `-shop`). */
export const SASH = 'window-sash';
export const SASH_SHOP = 'window-sash-shop';

/**
 * Replaces the GLB door leaves with the modelled ones and adds the window sashes (sized to the
 * glass of `window-plaster` / `shopwin-plaster`). Mutates `geometries`.
 */
export function addDoorAndSashModels(
  geometries: Map<string, BufferGeometry>,
  cells: TownCells,
): void {
  for (const look of LEAF_LOOKS) geometries.set(look, doorLeafGeometry(cells, look));
  const glass = cells.uv('glass');
  const win = geometries.get('window-plaster');
  const gb = (win && glassBounds(win, glass)) ?? { y0: 1, y1: 2.55, half: 0.4 };
  geometries.set(SASH, windowSashGeometry(cells, gb.half * 2 + 0.04, gb.y0 - 0.02, gb.y1 + 0.02));
  const shop = geometries.get('shopwin-plaster');
  const sb = (shop && glassBounds(shop, glass)) ?? { y0: 0.36, y1: 2.5, half: 0.44 };
  geometries.set(SASH_SHOP, windowSashGeometry(cells, sb.half * 2, sb.y0, sb.y1, 'frame-dark'));
}
