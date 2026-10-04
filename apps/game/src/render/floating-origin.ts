import { Group, type Camera } from 'three';
import { CHUNK_SIZE } from '../world/chunk.js';

/**
 * Floating origin for big worlds (up to 16 384 m): float32 GPU buffers and world-space shader
 * maths (shadows, fog, lighting) lose precision far from (0, 0), so the scene is drawn around a
 * render origin near the player instead.
 *
 * Spaces:
 * - world: absolute three.js coordinates (`simToWorld`; sim x → X, sim y → Z). The sim, chunk
 *   streaming, cutaway, lighting focus and every placed object use it; world content lives under
 *   `FloatingOrigin.root`.
 * - render: world minus the origin (`root.position = -origin`). The camera, the sun / moon light
 *   and the shadow fit work here; screen <-> world goes through `worldCamera` (the render camera
 *   moved by +origin), so picking and HUD projections keep using world coordinates.
 *
 * The origin only moves in whole chunks, once the focus is farther than `RECENTER_DISTANCE`
 * from it; chunk geometry / instances are relative to their chunk origin, so a shift is a
 * single root transform (no rebuild), plus the furniture batches (see `MapObjects.setOrigin`).
 */
export const RECENTER_DISTANCE = 1000;

export interface OriginXZ {
  readonly x: number;
  readonly z: number;
}

/**
 * The new render origin when `focus` (world X / Z) is more than `distance` from `origin`
 * (Chebyshev, per axis): the focus snapped down to its chunk corner. Undefined = keep.
 */
export function recenter(
  originX: number,
  originZ: number,
  focusX: number,
  focusZ: number,
  distance = RECENTER_DISTANCE,
  align = CHUNK_SIZE,
): OriginXZ | undefined {
  if (Math.abs(focusX - originX) <= distance && Math.abs(focusZ - originZ) <= distance) {
    return undefined;
  }
  const [x, z] = chunkCorner(focusX, focusZ, align);
  return { x, z };
}

/** Chunk corner (world X / Z) containing a point: render origins are always chunk-aligned. */
export const chunkCorner = (x: number, z: number, align = CHUNK_SIZE): [number, number] => [
  Math.floor(x / align) * align,
  Math.floor(z / align) * align,
];

/** World -> render (in place unless `out` is given). */
export function worldToRender<T extends { x: number; z: number }>(
  origin: OriginXZ,
  p: T,
  out: T = p,
): T {
  out.x = p.x - origin.x;
  out.z = p.z - origin.z;
  return out;
}

/** Render -> world (in place unless `out` is given). */
export function renderToWorld<T extends { x: number; z: number }>(
  origin: OriginXZ,
  p: T,
  out: T = p,
): T {
  out.x = p.x + origin.x;
  out.z = p.z + origin.z;
  return out;
}

export class FloatingOrigin implements OriginXZ {
  /** Parent of all world content; sits at -origin. */
  readonly root = new Group();
  x = 0;
  z = 0;
  private readonly listeners: ((o: OriginXZ) => void)[] = [];

  constructor(
    readonly distance = RECENTER_DISTANCE,
    readonly align = CHUNK_SIZE,
  ) {
    this.root.name = 'world-root';
  }

  /** Called after each shift (e.g. rebuild origin-relative batches). */
  onShift(fn: (o: OriginXZ) => void): void {
    this.listeners.push(fn);
  }

  /** Per frame with the focus (player, world X / Z). Returns true when the origin moved. */
  update(focusX: number, focusZ: number): boolean {
    const next = recenter(this.x, this.z, focusX, focusZ, this.distance, this.align);
    if (!next) return false;
    this.set(next.x, next.z);
    return true;
  }

  /** Moves the origin (world X / Z) right away. */
  set(x: number, z: number): void {
    if (x === this.x && z === this.z) return;
    this.x = x;
    this.z = z;
    this.root.position.set(-x, 0, -z);
    this.root.updateMatrixWorld(true);
    for (const fn of this.listeners) fn(this);
  }

  /**
   * Copies the render camera into `world` moved by +origin: a camera in world space for
   * projections / unprojections (picking, HUD anchors, per-instance culling).
   */
  syncWorldCamera<C extends Camera>(render: C, world: C): C {
    world.copy(render, false);
    world.position.x += this.x;
    world.position.z += this.z;
    world.updateMatrixWorld(true);
    return world;
  }
}
