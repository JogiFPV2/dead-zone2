/**
 * View-side motion smoothing: the drawn body follows the sim position with a ramped velocity
 * (no instant start / stop) and turns at a limited rate. Pure presentation; the sim position
 * stays the authority and the drawn body never drifts more than `maxLag` tiles from it.
 */
export interface MotionTuning {
  /** Acceleration / braking limit of the drawn body (tiles/s^2). */
  accel: number;
  /** Max turn rate (rad/s). */
  turnRate: number;
  /** Exponential turn smoothing (1/s). */
  turnSmooth: number;
  /** Position error correction (1/s). */
  correct: number;
  /** Hard cap of the drawn offset from the sim position (tiles). */
  maxLag: number;
}

// The sim already ramps the player (0.2 s up, 0.15 s down) and caps the facing turn (720 deg/s),
// so the player tuning only bridges 20 Hz snapshots (accel well above the sim ramp).
export const PLAYER_MOTION: MotionTuning = {
  accel: 60,
  turnRate: 14,
  turnSmooth: 18,
  correct: 10,
  maxLag: 0.3,
};

// Zombie pace (incl. the +-20% stagger) comes from the sim; this only smooths it.
export const ZOMBIE_MOTION: MotionTuning = {
  accel: 24,
  turnRate: 4,
  turnSmooth: 7,
  correct: 6,
  maxLag: 0.6,
};

/** Beyond this the body snaps (teleport, spawn, floor change). */
const SNAP_TILES = 2;

export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class BodyMotion {
  x = 0;
  y = 0;
  z = 0;
  facing = 0;
  /** Drawn velocity (tiles/s). */
  vx = 0;
  vy = 0;
  /** Forward acceleration along the facing (tiles/s^2, smoothed; + = speeding up). */
  accel = 0;
  private init = false;

  /** Drawn speed (tiles/s). */
  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /**
   * Steps towards the interpolated sim pose (`x`, `y`, `z`, `facing`) moving at sim velocity
   * (`tvx`, `tvy`, tiles/s). `turnRate` overrides the tuning (per-zombie gaits); `lockFacing`
   * freezes the heading (lying, dead).
   */
  update(
    x: number,
    y: number,
    z: number,
    facing: number,
    tvx: number,
    tvy: number,
    dtS: number,
    t: MotionTuning,
    turnRate = t.turnRate,
    lockFacing = false,
  ): void {
    const far = Math.hypot(x - this.x, y - this.y) > SNAP_TILES;
    if (!this.init || z !== this.z || far || dtS > 0.5) {
      this.init = true;
      this.x = x;
      this.y = y;
      this.z = z;
      this.facing = facing;
      this.vx = tvx;
      this.vy = tvy;
      this.accel = 0;
      return;
    }
    const dt = Math.max(0, dtS);
    const fx = Math.cos(this.facing);
    const fy = Math.sin(this.facing);
    const before = this.vx * fx + this.vy * fy;
    // Ramp the drawn velocity towards the sim velocity (accel-limited).
    const dvx = tvx - this.vx;
    const dvy = tvy - this.vy;
    const dv = Math.hypot(dvx, dvy);
    const maxDv = t.accel * dt;
    const k = dv > maxDv ? maxDv / dv : 1;
    this.vx += dvx * k;
    this.vy += dvy * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Pull back onto the sim position; never further than maxLag.
    const c = 1 - Math.exp(-t.correct * dt);
    this.x += (x - this.x) * c;
    this.y += (y - this.y) * c;
    const ex = this.x - x;
    const ey = this.y - y;
    const e = Math.hypot(ex, ey);
    if (e > t.maxLag) {
      this.x = x + (ex / e) * t.maxLag;
      this.y = y + (ey / e) * t.maxLag;
    }
    const a = dt > 0 ? (this.vx * fx + this.vy * fy - before) / dt : 0;
    this.accel += (a - this.accel) * (1 - Math.exp(-10 * dt));
    if (lockFacing) return;
    const d = wrapAngle(facing - this.facing);
    const step = d * (1 - Math.exp(-t.turnSmooth * dt));
    const lim = turnRate * dt;
    this.facing = wrapAngle(this.facing + Math.max(-lim, Math.min(lim, step)));
  }
}
