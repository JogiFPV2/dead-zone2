import { describe, expect, it } from 'vitest';
import { VehicleTypeSchema } from '../schemas/vehicle-type.js';
import { validatePacks } from '../validate/validate-packs.js';
import { baseBundle } from './base-bundle.js';
import { miniBase } from './helpers.js';

const car = {
  id: 'base:car',
  name: 'vehicle.base.car.name',
  length: 4,
  width: 1.8,
  wheelbase: 2.5,
  track: 1.5,
  wheelRadius: 0.3,
  mass: 1000,
  enginePower: 60,
  maxSpeed: 40,
  fuelMax: 40,
  consumption: 0.003,
  seats: [{ id: 'driver', doorSide: 'left', offset: { x: 0, y: -0.4 } }],
};
const paths = (r: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join('.'));

describe('pojazdy', () => {
  it('schemat: domyślne pojemności, rozstaw mniejszy niż auto, miejsca w aucie i bez powtórzeń', () => {
    expect(VehicleTypeSchema.parse(car)).toMatchObject({
      trunkCapacity: 0,
      gloveboxCapacity: 0,
      tags: [],
    });
    expect(paths(VehicleTypeSchema.safeParse({ ...car, wheelbase: 4 }))).toEqual(['wheelbase']);
    expect(paths(VehicleTypeSchema.safeParse({ ...car, track: 2 }))).toEqual(['track']);
    const seat = car.seats[0]!;
    const twice = { ...car, seats: [seat, { ...seat, doorSide: 'right' }] };
    expect(paths(VehicleTypeSchema.safeParse(twice))).toEqual(['seats.1.id']);
    const out = { ...car, seats: [{ ...seat, offset: { x: 3, y: 0 } }] };
    expect(paths(VehicleTypeSchema.safeParse(out))).toEqual(['seats.0.offset']);
    expect(VehicleTypeSchema.safeParse({ ...car, seats: [] }).success).toBe(false);
  });

  it('walidator: plik w vehicle-types/ trafia do vehicleTypes', () => {
    const r = validatePacks([miniBase({ 'vehicle-types/car.json': car })]);
    expect(r.errors).toEqual([]);
  });

  it('paczka bazowa: sedan ok. 1200 kg z kierowcą po lewej i 4 miejscami', async () => {
    const t = (await baseBundle()).vehicleTypes;
    expect(Object.keys(t)).toEqual(['base:sedan']);
    const s = t['base:sedan']!;
    expect(s.mass).toBe(1200);
    expect(s.seats.map((x) => x.id)).toEqual([
      'driver',
      'front-passenger',
      'rear-left',
      'rear-right',
    ]);
    expect(s.seats[0]?.doorSide).toBe('left');
    expect(s.trunkCapacity).toBeGreaterThan(0);
  });
});
