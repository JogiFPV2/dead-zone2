import type { Box3, PerspectiveCamera } from 'three';
import type { MeshPart } from './appearance-map.js';

/** Elevation of the preview camera (deg, as in deadzone-icons/render/char.html). */
const ELEVATION = (8 * Math.PI) / 180;
const PAD = 1.12;

/** Distance at which a vertical span fills a perspective camera of `fovDeg` (with `pad`). */
export function fitDistance(span: number, fovDeg: number, pad = PAD): number {
  return (span * pad) / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * Full-body framing: the camera looks at the character's middle; `zoom` < 1 moves closer and
 * aims a bit higher (towards the face). Character stands at the origin, faces +Z.
 */
export function orbitCamera(cam: PerspectiveCamera, height: number, zoom: number): void {
  const span = Math.max(height, (height * 0.5) / Math.max(cam.aspect, 0.01)) * zoom;
  const ty = height * (0.5 + (1 - zoom) * 0.55);
  const d = fitDistance(span, cam.fov);
  cam.position.set(0, ty + Math.sin(ELEVATION) * d, Math.cos(ELEVATION) * d);
  cam.lookAt(0, ty, 0);
}

/** 3/4 view of one part's own bounding box (tile thumbnails), square aspect. */
export function partFrame(cam: PerspectiveCamera, box: Box3, part: MeshPart): void {
  const h = box.max.y - box.min.y;
  const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const span = Math.max(h, w * (part === 'Body' ? 0.75 : 1));
  const d = fitDistance(span, cam.fov, 1.12);
  const az = (25 * Math.PI) / 180;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  cam.aspect = 1;
  cam.position.set(cx + Math.sin(az) * d, cy + Math.sin(ELEVATION) * d, cz + Math.cos(az) * d);
  cam.lookAt(cx, cy, cz);
  cam.updateProjectionMatrix();
}
