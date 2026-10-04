import { decodeVehicleSnapshot, VEHICLE_SNAPSHOT_STRIDE } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { runTicks } from '../test/ai-fixtures.js';
import {
  car,
  controls,
  seatedSim,
  vehicleSim,
  type VehicleSimOptions,
} from '../test/vehicle-fixtures.js';

/** A scripted drive: accelerate, steer, handbrake turn, brake; zombies on the way. */
function script(sim: Sim, ctl: ReturnType<typeof controls>, from: number, to: number): void {
  for (let t = from; t < to; t++) {
    if (t === 0) ctl.drive(1);
    if (t === 60) ctl.drive(0.6, 0, 0.5);
    if (t === 100) ctl.drive(0, 0, 1, true);
    if (t === 130) ctl.drive(1, 0, -0.3);
    if (t === 200) ctl.drive(0, 1);
    sim.step();
  }
}

const zombies: VehicleSimOptions['zombies'] = [
  { x: 40, y: 64 },
  { x: 44, y: 66 },
  { x: 50, y: 70, type: 'fixture:dummy' },
  { x: 60, y: 75 },
];

describe('vehicles: state, snapshot, save, freezing', () => {
  it('is deterministic (same commands → same hash and same vehicle snapshot)', () => {
    const run = () => {
      const { sim, ctl } = seatedSim({ zombies });
      script(sim, ctl, 0, 260);
      return {
        hash: sim.hash(),
        snap: decodeVehicleSnapshot(sim.vehicleSnapshot()),
        z: sim.getZombies(),
      };
    };
    const a = run();
    const b = run();
    expect(b.hash).toBe(a.hash);
    expect(b.snap).toEqual(a.snap);
    expect(b.z).toEqual(a.z);
  });

  it('save → load → same hash now and after more ticks (vehicles, seats, controls)', () => {
    const opts = { zombies };
    const { sim: a, ctl } = seatedSim(opts);
    script(a, ctl, 0, 90);
    expect(Math.abs(car(a).speed)).toBeGreaterThan(1);
    const blob = a.save();
    const b = vehicleSim({ ...opts, load: blob, spawnVehicles: [] });
    expect(b.tick).toBe(a.tick);
    expect(b.hash()).toBe(a.hash());
    expect(b.getVehicles()).toEqual(a.getVehicles());
    const ctlB = controls(b, 0, ctl.seq);
    script(a, ctl, 90, 300);
    script(b, ctlB, 90, 300);
    expect(b.hash()).toBe(a.hash());
    expect(b.getVehicles()).toEqual(a.getVehicles());
  });

  it('vehicle snapshot block: own stride, StableId order, fields match the sim', () => {
    const { sim, ctl } = seatedSim({
      spawnVehicles: [
        { x: 20, y: 64 },
        { x: 40, y: 90, heading: Math.PI / 2 },
      ],
    });
    ctl.drive(1, 0, 0.3, false);
    runTicks(sim, 30);
    const buf = sim.vehicleSnapshot();
    expect(buf.byteLength).toBe(2 * VEHICLE_SNAPSHOT_STRIDE * 4);
    expect(sim.vehicleSnapshotByteLength()).toBe(buf.byteLength);
    const [s0, s1] = decodeVehicleSnapshot(buf);
    const [v0, v1] = sim.getVehicles();
    expect(s0!.stableId).toBe(v0!.stableId);
    expect(s0!.stableId).toBeLessThan(s1!.stableId);
    expect(s0!.x).toBeCloseTo(v0!.x, 5);
    expect(s0!.speed).toBeCloseTo(v0!.speed, 5);
    expect(s0!.facingRad).toBeCloseTo(v0!.headingRad, 5);
    expect(s0!.driverId).toBe(1);
    expect(s0!.steer).toBeGreaterThan(0);
    expect(s0!.wheelsSpin).toBeGreaterThan(0);
    expect(s0!.damage).toEqual({ front: 1, rear: 1, left: 1, right: 1 });
    expect(s1!.driverId).toBe(0);
    expect(s1!.facingRad).toBeCloseTo(Math.PI / 2, 3);
    expect(v1!.heading).toBe(16384);
    expect(s1!.suspension).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('a car outside every active chunk window is frozen and untouched; nearby cars run', () => {
    // Player at x ≈ 20 (chunk 0); the second car at x = 230 (chunk 7) with a zombie inside it.
    const sim = vehicleSim({
      spawnVehicles: [
        { x: 20, y: 64 },
        { x: 230, y: 64 },
      ],
      zombies: [{ x: 230.5, y: 64.2, type: 'fixture:dummy' }],
    });
    runTicks(sim, 2);
    const before = sim.getVehicles()[1]!;
    const z0 = sim.getZombies()[0]!;
    runTicks(sim, 60);
    const [near, far] = sim.getVehicles();
    expect(near!.frozen).toBe(false);
    expect(far!.frozen).toBe(true);
    expect(far).toEqual(before);
    // An active car would have pushed the zombie out of its box.
    const z = sim.getZombies()[0]!;
    expect(z.x).toBeCloseTo(z0.x, 3);
    expect(z.y).toBeCloseTo(z0.y, 3);
    // Frozen cars are still in the snapshot (parked).
    expect(decodeVehicleSnapshot(sim.vehicleSnapshot())).toHaveLength(2);
  });

  it('a far car inside a `setInterest` window runs again (interest reuses the active window)', () => {
    const sim = vehicleSim({
      spawnVehicles: [
        { x: 20, y: 64 },
        { x: 230, y: 64 },
      ],
    });
    runTicks(sim, 2);
    expect(sim.getVehicles()[1]!.frozen).toBe(true);
    const r = sim.enqueue({
      type: 'setInterest',
      cx: 7,
      cy: 2,
      radiusChunks: 1,
      tick: sim.tick,
      playerId: 0,
      seq: 1,
    } as never);
    expect(r.ok).toBe(true);
    runTicks(sim, 2);
    expect(sim.getVehicles()[1]!.frozen).toBe(false);
  });
});
