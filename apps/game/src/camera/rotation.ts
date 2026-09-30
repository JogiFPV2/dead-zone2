import { ISO_YAW } from './isometric.js';

export const QUARTER_TURN = Math.PI / 2;
export const ROTATION_MS = 200;

/** Yaw for a given 90° step index (0 = classic view from +X+Z). */
export const yawForStep = (step: number): number => ISO_YAW + step * QUARTER_TURN;

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export interface YawTween {
  from: number;
  to: number;
  startMs: number;
  durationMs: number;
}

/** Yaw at `nowMs`; returns `to` once the tween is finished. */
export function sampleYaw(tween: YawTween, nowMs: number): number {
  const t = tween.durationMs <= 0 ? 1 : (nowMs - tween.startMs) / tween.durationMs;
  if (t >= 1) return tween.to;
  if (t <= 0) return tween.from;
  return tween.from + (tween.to - tween.from) * easeInOutCubic(t);
}

export const isTweenDone = (tween: YawTween, nowMs: number): boolean =>
  nowMs - tween.startMs >= tween.durationMs;
