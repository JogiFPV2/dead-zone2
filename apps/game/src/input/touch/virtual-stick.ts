import type { Gait } from '@deadzone/protocol';

/** Below this deflection (of the stick radius) the stick is idle. */
export const STICK_DEAD_ZONE = 0.12;
/** Above this deflection the character runs (mockup: „bieg auto przy >90%”). */
export const STICK_RUN_AT = 0.9;
/** Stick radius (CSS px): ring Ø120 (mockup). */
export const STICK_RADIUS_PX = 60;
/** Knob diameter (CSS px). */
export const STICK_KNOB_PX = 48;

export interface StickVector {
  /** Screen right, -1..1 (after the dead zone, rescaled so it starts at 0). */
  x: number;
  /** Screen down, -1..1. */
  y: number;
  /** Length of (x, y), 0..1. */
  mag: number;
  /** Full deflection (≥ STICK_RUN_AT of the radius). */
  run: boolean;
}

export const IDLE_STICK: StickVector = Object.freeze({ x: 0, y: 0, mag: 0, run: false });

/**
 * Stick offset (px from its centre) → vector. Clamped to the radius; inside the dead zone idle;
 * outside it the length is rescaled from the dead zone edge (0) to the rim (1).
 */
export function stickVector(
  dx: number,
  dy: number,
  radius = STICK_RADIUS_PX,
  deadZone = STICK_DEAD_ZONE,
  runAt = STICK_RUN_AT,
): StickVector {
  const d = Math.hypot(dx, dy);
  if (radius <= 0 || d === 0) return IDLE_STICK;
  const raw = Math.min(1, d / radius);
  if (raw < deadZone) return IDLE_STICK;
  const mag = (raw - deadZone) / (1 - deadZone);
  return { x: (dx / d) * mag, y: (dy / d) * mag, mag, run: raw > runAt };
}

export interface StickMove {
  dx: number;
  dy: number;
  gait: Gait;
}

/**
 * Stick → `move` command (same camera mapping as WASD, `moveDirection`): screen up = away from
 * the camera. Partial deflection walks slower (analog length, the sim clamps to 1); full = run.
 */
export function stickMove(v: StickVector, yaw: number): StickMove {
  if (v.mag === 0) return { dx: 0, dy: 0, gait: 'walk' };
  const f = -v.y;
  const r = v.x;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  let x = -s * f + c * r;
  let z = -c * f - s * r;
  // Running: full speed in that direction.
  if (v.run) {
    const len = Math.hypot(x, z);
    x /= len;
    z /= len;
  }
  // Quantised (1/50) so finger jitter does not send a `move` every frame.
  const snap = (n: number) => Math.round(n * 50) / 50 || 0;
  return { dx: snap(x), dy: snap(z), gait: v.run ? 'run' : 'walk' };
}

/**
 * Floating stick: the touch that starts it is its centre; moves give the vector. One finger
 * (pointer id) owns it until it lifts. The UI may also feed it its own centre (`start`).
 */
export class VirtualStick {
  private id: number | undefined;
  private cx = 0;
  private cy = 0;
  private v: StickVector = IDLE_STICK;

  constructor(private readonly radius = STICK_RADIUS_PX) {}

  get active(): boolean {
    return this.id !== undefined;
  }

  get vector(): StickVector {
    return this.v;
  }

  /** Centre and knob offset (CSS px, knob clamped to the ring) for drawing. */
  get knob(): { cx: number; cy: number; dx: number; dy: number } {
    const k = this.radius;
    return { cx: this.cx, cy: this.cy, dx: this.v.x * k || 0, dy: this.v.y * k || 0 };
  }

  start(id: number, x: number, y: number): void {
    this.id = id;
    this.cx = x;
    this.cy = y;
    this.v = IDLE_STICK;
  }

  move(id: number, x: number, y: number): void {
    if (id !== this.id) return;
    this.v = stickVector(x - this.cx, y - this.cy, this.radius);
  }

  end(id?: number): void {
    if (id !== undefined && id !== this.id) return;
    this.id = undefined;
    this.v = IDLE_STICK;
  }
}
