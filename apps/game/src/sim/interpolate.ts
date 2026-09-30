import type { EntityState } from './snapshot.js';

/** Alpha between the last two ticks: time since last tick / tick length, clamped to [0, 1]. */
export function tickAlpha(nowMs: number, lastTickMs: number, tickMs: number): number {
  if (tickMs <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - lastTickMs) / tickMs));
}

/** Lerp between angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export function interpolateEntity(
  prev: EntityState,
  curr: EntityState,
  alpha: number,
): EntityState {
  return {
    id: curr.id,
    x: prev.x + (curr.x - prev.x) * alpha,
    y: prev.y + (curr.y - prev.y) * alpha,
    z: prev.z + (curr.z - prev.z) * alpha,
    facing: lerpAngle(prev.facing, curr.facing, alpha),
  };
}

/** Keeps the last two player states and when the newest arrived. */
export class SnapshotBuffer {
  private prev: EntityState | undefined;
  private curr: EntityState | undefined;
  private arrivedMs = 0;

  push(state: EntityState, nowMs: number): void {
    this.prev = this.curr ?? state;
    this.curr = state;
    this.arrivedMs = nowMs;
  }

  sample(nowMs: number, tickMs: number): EntityState | undefined {
    if (!this.prev || !this.curr) return undefined;
    return interpolateEntity(this.prev, this.curr, tickAlpha(nowMs, this.arrivedMs, tickMs));
  }
}
