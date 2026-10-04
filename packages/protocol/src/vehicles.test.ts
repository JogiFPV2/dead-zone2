import { describe, expect, it } from 'vitest';
import {
  decodeVehicleSnapshot,
  encodeVehicleSnapshot,
  ENTITY_PHYS_STATES,
  packVehicleDamage,
  packVehicleEngine,
  packVehicleTires,
  unpackVehicleDamage,
  unpackVehicleEngine,
  unpackVehicleTires,
  VEHICLE_PARTS,
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
  tires: [1, 0, 51 / 255, 1],
  engine: 102 / 255,
  windowsBroken: 0b1001,
};

describe('vehicle snapshot block', () => {
  it('21 words per vehicle, round trip (u32 doorsOpen / damage / tires / engine)', () => {
    expect(VEHICLE_SNAPSHOT_STRIDE).toBe(21);
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

  it('tires: 4 × u8 FL … RR; engine: u8 hp + broken-window bits 8–11', () => {
    expect(packVehicleTires([1, 0, 0, 1])).toBe(0xff0000ff);
    expect(unpackVehicleTires(0x00ff00ff)).toEqual([1, 0, 1, 0]);
    expect(packVehicleEngine(1, 0b0010)).toBe(0x2ff);
    expect(unpackVehicleEngine(0x8ff)).toEqual({ engine: 1, windowsBroken: 0b1000 });
    expect(VEHICLE_PARTS).toHaveLength(15);
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
