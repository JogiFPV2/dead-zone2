import { Vector3, type OrthographicCamera } from 'three';
import { isometricOffset } from './isometric.js';
import { ROTATION_MS, sampleYaw, yawForStep, type YawTween } from './rotation.js';
import { DEFAULT_ZOOM_LIMITS, zoomFromWheel, type ZoomLimits } from './zoom.js';

/** Camera state (target, yaw step, zoom). No DOM: input is wired separately. */
export class CameraRig {
  readonly target = new Vector3();
  private step = 0;
  private tween: YawTween;

  constructor(
    private readonly camera: OrthographicCamera,
    private readonly distance = 100,
    private readonly zoomLimits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
  ) {
    const yaw = yawForStep(0);
    this.tween = { from: yaw, to: yaw, startMs: 0, durationMs: 0 };
    this.apply(yaw);
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  /** Rotate the view by one 90° step: +1 (E) or -1 (Q), with a short tween. */
  rotate(direction: 1 | -1, nowMs: number): void {
    const from = sampleYaw(this.tween, nowMs);
    this.step += direction;
    this.tween = { from, to: yawForStep(this.step), startMs: nowMs, durationMs: ROTATION_MS };
  }

  zoomByWheel(deltaY: number): void {
    this.camera.zoom = zoomFromWheel(this.camera.zoom, deltaY, this.zoomLimits);
    this.camera.updateProjectionMatrix();
  }

  /** Call once per frame. */
  update(nowMs: number): void {
    this.apply(sampleYaw(this.tween, nowMs));
  }

  private apply(yaw: number): void {
    this.camera.position.copy(this.target).add(isometricOffset(this.distance, yaw));
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
