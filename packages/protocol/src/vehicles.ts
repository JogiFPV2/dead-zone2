/**
 * Vehicles (PROTOCOL_VERSION 12): a separate snapshot block next to the entity snapshot (the
 * entity stride does not change). `snapshot` messages carry it as `vehicles` (a transferred
 * `ArrayBuffer`, absent when the world has no vehicles).
 *
 * Layout, VEHICLE_SNAPSHOT_STRIDE 32-bit words per vehicle, in StableId order:
 * ```
 *   stableId, variant, x, y, z, facingRad, speed, steer, brakeLight, headlights, doorsOpen*,
 *   driverId, slip, wheelsSpin, suspFL, suspFR, suspRL, suspRR, damage*
 * ```
 * Words marked `*` (VEHICLE_U32_FIELDS) are u32 bit patterns (read through a `Uint32Array`).
 * - x / y: centre of the car in tiles (1 tile = 1 m), z: level; facingRad like entities (from +x
 *   towards +y), the direction the nose points.
 * - variant: index of the vehicle type in the content ids sorted ascending
 *   (`Object.keys(bundle.vehicleTypes).sort()`).
 * - speed: signed speed along the nose in m/s (negative = reversing); steer −1..1 (left..right,
 *   −1 = full lock towards −y when facing +x); brakeLight / headlights 0 or 1.
 * - doorsOpen: bit i = door of seat i (content `seats[i]`) is open.
 * - driverId: StableId of the driver, 0 = nobody.
 * - slip 0..1: how much the car slides sideways (tyre squeal, skid marks).
 * - wheelsSpin: wheel rotation angle in rad (wraps at 2π; spin = distance / wheel radius).
 * - suspFL..suspRR: suspension compression 0..1 per wheel (0.5 at rest; dips on braking).
 * - damage: hp of the body zones packed as 4 × u8 (0..255 = 0..100 %): bits 0–7 front,
 *   8–15 rear, 16–23 left, 24–31 right (`unpackVehicleDamage`).
 */
export const VEHICLE_SNAPSHOT_STRIDE = 19;
export const VehicleField = {
  stableId: 0,
  variant: 1,
  x: 2,
  y: 3,
  z: 4,
  facingRad: 5,
  speed: 6,
  steer: 7,
  brakeLight: 8,
  headlights: 9,
  doorsOpen: 10,
  driverId: 11,
  slip: 12,
  wheelsSpin: 13,
  suspFL: 14,
  suspFR: 15,
  suspRL: 16,
  suspRR: 17,
  damage: 18,
} as const;
export const VEHICLE_U32_FIELDS = [VehicleField.doorsOpen, VehicleField.damage] as const;

/** Body zones of a vehicle (damage, impacts). */
export const VEHICLE_ZONES = ['front', 'rear', 'left', 'right'] as const;
export type VehicleZone = (typeof VEHICLE_ZONES)[number];

/** What a vehicle hit (`vehicleImpact.targetKind`). */
export const VEHICLE_IMPACT_TARGETS = [
  'wall',
  'fence',
  'zombie',
  'player',
  'animal',
  'vehicle',
] as const;
export type VehicleImpactTarget = (typeof VEHICLE_IMPACT_TARGETS)[number];

export interface SnapshotVehicle {
  stableId: number;
  variant: number;
  x: number;
  y: number;
  z: number;
  facingRad: number;
  speed: number;
  steer: number;
  brakeLight: boolean;
  headlights: boolean;
  doorsOpen: number;
  driverId: number;
  slip: number;
  wheelsSpin: number;
  /** FL, FR, RL, RR, 0..1. */
  suspension: [number, number, number, number];
  /** Zone hp 0..1 (front, rear, left, right). */
  damage: Record<VehicleZone, number>;
}

export const vehicleSnapshotByteLength = (count: number): number =>
  count * VEHICLE_SNAPSHOT_STRIDE * Float32Array.BYTES_PER_ELEMENT;

export const vehicleSnapshotCount = (buf: ArrayBuffer): number =>
  Math.floor(buf.byteLength / (VEHICLE_SNAPSHOT_STRIDE * Float32Array.BYTES_PER_ELEMENT));

/** Zone hp 0..1 → one u32 (4 × u8). */
export function packVehicleDamage(d: Record<VehicleZone, number>): number {
  let v = 0;
  VEHICLE_ZONES.forEach((z, i) => {
    const b = Math.max(0, Math.min(255, Math.round((d[z] ?? 0) * 255)));
    v |= b << (i * 8);
  });
  return v >>> 0;
}

export function unpackVehicleDamage(v: number): Record<VehicleZone, number> {
  const out = {} as Record<VehicleZone, number>;
  VEHICLE_ZONES.forEach((z, i) => (out[z] = ((v >>> (i * 8)) & 0xff) / 255));
  return out;
}

/** Writes vehicles into `buf` when its size matches, otherwise into a new buffer. */
export function encodeVehicleSnapshot(
  vehicles: readonly SnapshotVehicle[],
  buf?: ArrayBuffer,
): ArrayBuffer {
  const bytes = vehicleSnapshotByteLength(vehicles.length);
  const out = buf?.byteLength === bytes ? buf : new ArrayBuffer(bytes);
  const f = new Float32Array(out);
  const u = new Uint32Array(out);
  let o = 0;
  for (const v of vehicles) {
    f[o] = v.stableId;
    f[o + 1] = v.variant;
    f[o + 2] = v.x;
    f[o + 3] = v.y;
    f[o + 4] = v.z;
    f[o + 5] = v.facingRad;
    f[o + 6] = v.speed;
    f[o + 7] = v.steer;
    f[o + 8] = v.brakeLight ? 1 : 0;
    f[o + 9] = v.headlights ? 1 : 0;
    u[o + 10] = v.doorsOpen >>> 0;
    f[o + 11] = v.driverId;
    f[o + 12] = v.slip;
    f[o + 13] = v.wheelsSpin;
    for (let i = 0; i < 4; i++) f[o + 14 + i] = v.suspension[i] ?? 0.5;
    u[o + 18] = packVehicleDamage(v.damage);
    o += VEHICLE_SNAPSHOT_STRIDE;
  }
  return out;
}

/** Convenience decoder (allocates; tests and tools). */
export function decodeVehicleSnapshot(buf: ArrayBuffer): SnapshotVehicle[] {
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const out: SnapshotVehicle[] = [];
  for (let i = 0, n = vehicleSnapshotCount(buf); i < n; i++) {
    const o = i * VEHICLE_SNAPSHOT_STRIDE;
    out.push({
      stableId: f[o] ?? 0,
      variant: f[o + 1] ?? 0,
      x: f[o + 2] ?? 0,
      y: f[o + 3] ?? 0,
      z: f[o + 4] ?? 0,
      facingRad: f[o + 5] ?? 0,
      speed: f[o + 6] ?? 0,
      steer: f[o + 7] ?? 0,
      brakeLight: f[o + 8] === 1,
      headlights: f[o + 9] === 1,
      doorsOpen: u[o + 10] ?? 0,
      driverId: f[o + 11] ?? 0,
      slip: f[o + 12] ?? 0,
      wheelsSpin: f[o + 13] ?? 0,
      suspension: [f[o + 14] ?? 0, f[o + 15] ?? 0, f[o + 16] ?? 0, f[o + 17] ?? 0],
      damage: unpackVehicleDamage(u[o + 18] ?? 0),
    });
  }
  return out;
}
