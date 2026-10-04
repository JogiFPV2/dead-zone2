/**
 * One vehicle (plain data: saved and hashed with the physics world, `w.physics.vehicles`, keyed
 * by StableId). Units: metres = tiles, m/s, rad/s, litres. Heading is a unit vector (hx, hy) in
 * f32 (the nose direction; right side = (−hy, hx)); facing for the client is atan2(hy, hx).
 */
export interface Vehicle {
  id: number;
  /** Index in the vehicle types sorted by id (= snapshot `variant`). */
  type: number;
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  /**
   * Heading as BAM (u16, 65536 = 360°, like `Facing.angle`), derived from (hx, hy) every tick;
   * the unit vector stays the integration state (a u16 angle would lose slow turns).
   */
  heading: number;
  /** World velocity (m/s) and yaw rate (rad/s, + = towards +y, i.e. turning right). */
  vx: number;
  vy: number;
  angVel: number;
  /** Signed speed along the nose (m/s), derived each tick. */
  speed: number;
  /** Driver input (held until the next `drive`): throttle / brake 0..1, steer −1..1. */
  throttle: number;
  brake: number;
  steerInput: number;
  handbrake: boolean;
  /** Actual steering −1..1 (follows `steerInput` at `steerRatePerSec`). */
  steer: number;
  headlights: boolean;
  engineOn: boolean;
  /** Bit i = door of seat i open; `doorTicks[i]` active ticks until it closes again. */
  doorsOpen: number;
  doorTicks: number[];
  /** StableId per seat (0 = empty); seat 0 is the driver. */
  occupants: number[];
  fuel: number;
  fuelMax: number;
  /** Container ids (trunk, glovebox): a hook for Symulacja, empty for now. */
  containers: number[];
  /** Sideways slide 0..1, wheel angle (rad), suspension FL, FR, RL, RR 0..1 (0.5 at rest). */
  slip: number;
  wheelSpin: number;
  susp: number[];
  /** Body zone hp 0..100: front, rear, left, right. */
  zones: number[];
  /**
   * StableIds of standing bodies the car touched last active tick (sorted): a body still in
   * contact is only shoved along (positional push + `plowDecel`), not hit again (no impulse,
   * no `vehicleImpact`, no ramming).
   */
  contacts: number[];
  /** Chunk of the centre (cx, cy), updated every active tick. */
  cx: number;
  cy: number;
  /** Tick it was frozen (outside every active chunk window, see `physics/active.ts`); −1 = active. */
  frozenAt: number;
}

/** Zone indices in `Vehicle.zones` (same order as protocol `VEHICLE_ZONES`). */
export const Zone = { front: 0, rear: 1, left: 2, right: 3 } as const;

/** Oriented box of a vehicle: centre, nose axis (hx, hy), half length / half width. */
export interface Obb {
  x: number;
  y: number;
  hx: number;
  hy: number;
  hl: number;
  hw: number;
}
