import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxesGeometry } from './blok-facade.js';

/** Sill board under the glass: thickness (m), depth out of the wall face on both sides. */
export const SILL_THICK = 0.06;
export const SILL_DEPTH = 0.22;
/** Sill height when a module has no glass (m above the floor). */
const SILL_Y_FALLBACK = 0.9;
/** Half width of the sill (the 1 m module stretched along gaps of vector walls). */
const SILL_HALF = 0.56;

/** Lowest y of the triangles in atlas cell `uv` (the glass of a window module). */
export function cellBottom(
  g: BufferGeometry,
  uv: readonly [number, number],
  cell = 1 / 16,
): number {
  const pos = g.getAttribute('position');
  const tex = g.getAttribute('uv');
  if (!tex) return Infinity;
  let lo = Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(tex.getX(i) - uv[0]) < cell / 2 && Math.abs(tex.getY(i) - uv[1]) < cell / 2)
      lo = Math.min(lo, pos.getY(i));
  }
  return lo;
}

/**
 * Window sills („parapety”, Paweł 24.11: details from geometry): a light board under the glass
 * of every kit window module (`window-<skin>`, `-lit`; derived skins and `-broken` follow),
 * sticking out on both sides (outside sill, inside window board). Stubs (cut-down walls) keep
 * none.
 */
export function addWindowSills(
  geometries: Map<string, BufferGeometry>,
  uv: (cell: string) => [number, number],
): void {
  const glass = uv('glass');
  const glassLit = uv('glass-lit');
  for (const [name, g] of [...geometries]) {
    if (!/^window-/.test(name) || name.endsWith('-broken')) continue;
    let y = Math.min(cellBottom(g, glass), cellBottom(g, glassLit));
    if (!Number.isFinite(y) || y < 0.3 || y > 1.6) y = SILL_Y_FALLBACK;
    const sill = boxesGeometry(
      [
        {
          ox: 0,
          oz: 0,
          dx: 1,
          dz: 0,
          nx: 0,
          nz: 1,
          u0: -SILL_HALF,
          u1: SILL_HALF,
          y0: y - SILL_THICK,
          y1: y,
          n0: -SILL_DEPTH,
          n1: SILL_DEPTH,
          cell: 'trim-light',
        },
      ],
      uv,
    );
    const merged = mergeGeometries([g, sill], false);
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    geometries.set(name, merged);
  }
}
