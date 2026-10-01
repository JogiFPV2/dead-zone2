import { Vector3, type OrthographicCamera } from 'three';
import { CAMERA_DISTANCE, isometricOffset } from './isometric.js';
import { ROTATION_MS, sampleYaw, yawForStep, type YawTween } from './rotation.js';
import { DEFAULT_ZOOM_LIMITS, clamp, smoothZoom, zoomFromWheel, type ZoomLimits } from './zoom.js';

/** Camera state (target, yaw step, zoom). No DOM: input is wired separately. */
export class CameraRig {
  readonly target = new Vector3();
  private step = 0;
  private tween: YawTween;
  private zoomGoal: number;
  private lastUpdateMs: number | undefined;
  /** Called when the wheel changes the zoom target (e.g. to persist it). */
  onZoomTarget: ((zoom: number) => void) | undefined;

  constructor(
    private readonly camera: OrthographicCamera,
    private readonly distance = CAMERA_DISTANCE,
    private readonly zoomLimits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
  ) {
    const yaw = yawForStep(0);
    this.tween = { from: yaw, to: yaw, startMs: 0, durationMs: 0 };
    this.zoomGoal = camera.zoom;
    this.apply(yaw);
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  /** Zoom the camera is easing towards (the wheel target). */
  get zoomTarget(): number {
    return this.zoomGoal;
  }

  /** Yaw of the current 90° step (tween end), used to map WASD to world directions. */
  get targetYaw(): number {
    return this.tween.to;
  }

  /** Rotate the view by one 90° step: +1 (E) or -1 (Q), with a short tween. */
  rotate(direction: 1 | -1, nowMs: number): void {
    const from = sampleYaw(this.tween, nowMs);
    this.step += direction;
    this.tween = { from, to: yawForStep(this.step), startMs: nowMs, durationMs: ROTATION_MS };
  }

  /** Moves the zoom target; the camera eases there in `update` (smooth zoom). */
  zoomByWheel(deltaY: number): void {
    this.zoomGoal = zoomFromWheel(this.zoomGoal, deltaY, this.zoomLimits);
    this.onZoomTarget?.(this.zoomGoal);
  }

  /** Sets the zoom (clamped) right away, e.g. restored from settings. */
  setZoom(zoom: number): void {
    this.zoomGoal = clamp(zoom, this.zoomLimits.min, this.zoomLimits.max);
    this.camera.zoom = this.zoomGoal;
    this.camera.updateProjectionMatrix();
  }

  /** Call once per frame. */
  update(nowMs: number): void {
    const dt = this.lastUpdateMs === undefined ? 0 : nowMs - this.lastUpdateMs;
    this.lastUpdateMs = nowMs;
    if (this.camera.zoom !== this.zoomGoal) {
      this.camera.zoom = smoothZoom(this.camera.zoom, this.zoomGoal, dt);
      this.camera.updateProjectionMatrix();
    }
    this.apply(sampleYaw(this.tween, nowMs));
  }

  private apply(yaw: number): void {
    this.camera.position.copy(this.target).add(isometricOffset(this.distance, yaw));
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
