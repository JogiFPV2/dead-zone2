import type { MapZone } from '@deadzone/content';
import type { SimSpawn } from '@deadzone/protocol';

export type { MapZone };

/**
 * Player spawn from the map's first `start` zone: centre tile of its first rect (tile centre,
 * in tiles). `undefined` when the map has no start zone (the sim picks its default tile).
 */
export function startSpawn(zones: readonly MapZone[]): SimSpawn | undefined {
  const zone = zones.find((z) => z.role === 'start' && z.rects.length > 0);
  const r = zone?.rects[0];
  if (!zone || !r) return undefined;
  return { x: r.x + Math.floor(r.w / 2) + 0.5, y: r.y + Math.floor(r.h / 2) + 0.5, z: zone.z };
}

const ROLE_COLORS: Record<string, number> = {
  start: 0x3ccf5a,
  villa: 0xe0902c,
  extraction: 0x2c8fe0,
  /** Dark areas (no light; stealth/visibility later): violet, distinct from the others. */
  dark: 0x9b3fe0,
};

/** Debug colour per role (dev overlay only); unknown roles get a stable hashed hue. */
export function zoneColor(role: string): number {
  const fixed = ROLE_COLORS[role];
  if (fixed !== undefined) return fixed;
  let h = 0;
  for (const ch of role) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  // HSV(h, 0.7, 0.9) → RGB
  const hue = (h % 360) / 60;
  const c = 0.9 * 0.7;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = 0.9 - c;
  const [r, g, b] =
    hue < 1
      ? [c, x, 0]
      : hue < 2
        ? [x, c, 0]
        : hue < 3
          ? [0, c, x]
          : hue < 4
            ? [0, x, c]
            : hue < 5
              ? [x, 0, c]
              : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

export interface ZoneMeshData {
  /** Quads (2 triangles each): xyz per vertex, world space (X, Y up, Z). */
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Rect outlines as line segments (xyz pairs). */
  outline: Float32Array;
  outlineColors: Float32Array;
}

/**
 * Flat rectangles for all zone rects, merged into one buffer (one draw call for fills, one for
 * outlines). Sim tile (x, y, level) → world (x, level·levelHeight + lift, y).
 */
export function zoneMeshData(
  zones: readonly MapZone[],
  levelHeight: number,
  lift = 0.03,
): ZoneMeshData {
  const rects = zones.flatMap((z) => z.rects.map((r) => ({ r, z: z.z, color: zoneColor(z.role) })));
  const positions = new Float32Array(rects.length * 12);
  const colors = new Float32Array(rects.length * 12);
  const indices = new Uint32Array(rects.length * 6);
  const outline = new Float32Array(rects.length * 24);
  const outlineColors = new Float32Array(rects.length * 24);
  rects.forEach(({ r, z, color }, i) => {
    const y = z * levelHeight + lift;
    const corners = [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
    ] as const;
    const rgb = [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
    corners.forEach(([cx, cz], k) => {
      positions.set([cx, y, cz], i * 12 + k * 3);
      colors.set(rgb, i * 12 + k * 3);
      const [nx, nz] = corners[(k + 1) % 4]!;
      outline.set([cx, y, cz, nx, y, nz], i * 24 + k * 6);
      outlineColors.set([...rgb, ...rgb], i * 24 + k * 6);
    });
    const v = i * 4;
    indices.set([v, v + 2, v + 1, v, v + 3, v + 2], i * 6);
  });
  return { positions, colors, indices, outline, outlineColors };
}
