import { describe, expect, it } from 'vitest';
import {
  decodeVehicleSnapshot,
  encodeVehicleSnapshot,
  ENTITY_PHYS_STATES,
  packVehicleDamage,
  unpackVehicleDamage,
  VEHICLE_SNAPSHOT_STRIDE,
  vehicleSnapshotByteLength,
  type SnapshotVehicle,
} from './index.js';
import { parseCommand } from './schema.js';

const car: SnapshotVehicle = {
  stableId: 42,
  variant: 0,
  x: 10.5,
  y: 20.25,
  z: 0,
  facingRad: 1.5,
  speed: -2.5,
  steer: 0.5,
  brakeLight: true,
  headlights: false,
  doorsOpen: 0b0101,
  driverId: 1,
  slip: 0.25,
  wheelsSpin: 3,
  suspension: [0.5, 0.5, 0.25, 0.75],
  damage: { front: 1, rear: 0, left: 128 / 255, right: 1 },
};

describe('vehicle snapshot block', () => {
  it('19 words per vehicle, round trip (u32 doorsOpen / damage)', () => {
    expect(VEHICLE_SNAPSHOT_STRIDE).toBe(19);
    const buf = encodeVehicleSnapshot([car, { ...car, stableId: 43 }]);
    expect(buf.byteLength).toBe(vehicleSnapshotByteLength(2));
    const [a, b] = decodeVehicleSnapshot(buf);
    expect(a).toEqual(car);
    expect(b!.stableId).toBe(43);
  });

  it('damage packs 4 zones into one u32: front bits 0–7 … right bits 24–31', () => {
    const v = packVehicleDamage({ front: 1, rear: 0, left: 0, right: 1 });
    expect(v).toBe(0xff0000ff);
    expect(unpackVehicleDamage(v)).toEqual({ front: 1, rear: 0, left: 0, right: 1 });
  });

  it('state `driving` is appended (index 13); vehicle commands validate', () => {
    expect(ENTITY_PHYS_STATES.indexOf('driving')).toBe(13);
    const h = { tick: 1, playerId: 0, seq: 1 };
    expect(parseCommand({ ...h, type: 'enterVehicle', vehicleId: 5, seat: 0 }).ok).toBe(true);
    expect(parseCommand({ ...h, type: 'exitVehicle' }).ok).toBe(true);
    const drive = { ...h, type: 'drive', throttle: 1, brake: 0, steer: -1, handbrake: false };
    expect(parseCommand(drive).ok).toBe(true);
    expect(parseCommand({ ...drive, throttle: 1.5 }).ok).toBe(false);
    expect(parseCommand({ ...drive, steer: 2 }).ok).toBe(false);
  });
});
