import { Matrix4, Vector3, type OrthographicCamera } from 'three';

export interface ShadowFitOptions {
  /** Floor slab that must be covered: receivers and casters between these heights. */
  readonly minY: number;
  readonly maxY: number;
  /** Shadow map resolution (square), used to snap to whole texels. */
  readonly mapSize: number;
  /** Extra world units around the view footprint. */
  readonly margin: number;
  /** Half size is rounded up to this step so small view changes don't resize the map. */
  readonly sizeStep: number;
  /** Cap on the half size (far zoom-out). */
  readonly maxHalfSize: number;
  /** Extra depth towards the light for casters outside the slab. */
  readonly depthPadding: number;
}

export const DEFAULT_SHADOW_FIT: ShadowFitOptions = {
  minY: 0,
  maxY: 8,
  mapSize: 4096,
  margin: 2,
  sizeStep: 2,
  maxHalfSize: 80,
  depthPadding: 20,
};

export interface ShadowFit {
  /** Light target (world), on the texel grid. */
  readonly target: Vector3;
  /** Light position (world) = target + direction * distance. */
  readonly position: Vector3;
  /** Square orthographic frustum: left = bottom = -halfSize, right = top = halfSize. */
  readonly halfSize: number;
  readonly near: number;
  readonly far: number;
}

/** The view of an orthographic camera: world matrix, frustum and zoom. */
export type OrthoView = Pick<
  OrthographicCamera,
  'matrixWorld' | 'left' | 'right' | 'top' | 'bottom' | 'zoom'
>;

const UP = new Vector3(0, 1, 0);

/**
 * Points where the camera view (its 4 corner rays) crosses the planes y = minY and y = maxY:
 * the part of the world that can be on screen.
 */
export function viewFootprint(view: OrthoView, minY: number, maxY: number): Vector3[] {
  const { matrixWorld: m, zoom } = view;
  const forward = new Vector3(0, 0, -1).transformDirection(m);
  if (forward.y > -1e-6) throw new Error('viewFootprint: camera must look down');
  const out: Vector3[] = [];
  for (const x of [view.left / zoom, view.right / zoom]) {
    for (const y of [view.top / zoom, view.bottom / zoom]) {
      const origin = new Vector3(x, y, 0).applyMatrix4(m);
      for (const h of [minY, maxY]) {
        const t = (h - origin.y) / forward.y;
        out.push(origin.clone().addScaledVector(forward, t));
      }
    }
  }
  return out;
}

/**
 * Fits a directional light's shadow camera to the camera view. `direction` points from the
 * target towards the light. The frustum is square, its size quantised and its centre snapped to
 * whole shadow texels in light space, so shadows don't shimmer while the camera moves.
 */
export function fitShadowFrustum(
  view: OrthoView,
  direction: Vector3,
  options: ShadowFitOptions = DEFAULT_SHADOW_FIT,
): ShadowFit {
  const dir = direction.clone().normalize();
  // Same basis as the shadow camera (Object3D.lookAt from light to target, up +Y).
  const basis = new Matrix4().lookAt(dir, new Vector3(), UP);
  const toLight = basis.clone().invert();
  const pts = viewFootprint(view, options.minY, options.maxY).map((p) => p.applyMatrix4(toLight));

  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of pts) {
    min.min(p);
    max.max(p);
  }
  const raw = Math.max(max.x - min.x, max.y - min.y) / 2 + options.margin;
  const halfSize = Math.min(
    options.maxHalfSize,
    Math.ceil(raw / options.sizeStep) * options.sizeStep,
  );
  const texel = (2 * halfSize) / options.mapSize;
  const snap = (v: number) => Math.round(v / texel) * texel;
  // Centre in light space: x/y snapped to texels, z at the far (receiver) end of the slab.
  const centre = new Vector3(snap((min.x + max.x) / 2), snap((min.y + max.y) / 2), min.z);
  const target = centre.applyMatrix4(basis);
  const depth = max.z - min.z;
  const distance = depth + options.depthPadding;
  return {
    target,
    position: target.clone().addScaledVector(dir, distance),
    halfSize,
    near: 0.5,
    // Receivers sit at `distance` from the light; the extra padding covers bias and rounding.
    far: distance + options.margin + 1,
  };
}
