import { OrthographicCamera, Vector3 } from 'three';

/** Classic isometric angles: 45° yaw, atan(1/√2) ≈ 35.264° pitch (camera looks along -(1,1,1)). */
export const ISO_YAW = Math.PI / 4;
export const ISO_PITCH = Math.atan(1 / Math.SQRT2);

/** Default distance from the camera to its target. */
export const CAMERA_DISTANCE = 100;

export interface IsometricCameraOptions {
  /** Viewport width / height. */
  aspect: number;
  /** World units visible vertically at zoom 1. */
  viewHeight: number;
  /** Distance from target along the view axis (only affects clipping, not scale). */
  distance?: number;
  target?: Vector3;
}

/** Offset from the look-at target to the camera for given yaw/pitch. */
export function isometricOffset(distance: number, yaw = ISO_YAW, pitch = ISO_PITCH): Vector3 {
  const horizontal = distance * Math.cos(pitch);
  return new Vector3(
    horizontal * Math.sin(yaw),
    distance * Math.sin(pitch),
    horizontal * Math.cos(yaw),
  );
}

export function orthoFrustum(aspect: number, viewHeight: number) {
  const halfH = viewHeight / 2;
  const halfW = halfH * aspect;
  return { left: -halfW, right: halfW, top: halfH, bottom: -halfH };
}

export function createIsometricCamera(options: IsometricCameraOptions): OrthographicCamera {
  const { aspect, viewHeight, distance = CAMERA_DISTANCE, target = new Vector3() } = options;
  const f = orthoFrustum(aspect, viewHeight);
  const camera = new OrthographicCamera(f.left, f.right, f.top, f.bottom, 0.1, distance * 4);
  camera.position.copy(target).add(isometricOffset(distance));
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return camera;
}

/** Call on viewport resize; keeps world scale constant vertically. */
export function resizeIsometricCamera(
  camera: OrthographicCamera,
  aspect: number,
  viewHeight: number,
): void {
  Object.assign(camera, orthoFrustum(aspect, viewHeight));
  camera.updateProjectionMatrix();
}
