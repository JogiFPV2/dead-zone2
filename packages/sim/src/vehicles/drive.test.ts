import { describe, expect, it } from 'vitest';
import { eventsOf, runTicks } from '../test/ai-fixtures.js';
import { car, seatedSim } from '../test/vehicle-fixtures.js';

const TPS = 20;

describe('vehicles: driving', () => {
  it('accelerates in a straight line (0–50 km/h in a few seconds) and uses fuel', () => {
    const { sim, ctl } = seatedSim();
    const fuel0 = car(sim).fuel;
    ctl.drive(1);
    let t50 = -1;
    for (let i = 1; i <= 15 * TPS; i++) {
      sim.step();
      if (t50 < 0 && car(sim).speed >= 50 / 3.6) t50 = i / TPS;
    }
    const c = car(sim);
    expect(t50).toBeGreaterThan(2);
    expect(t50).toBeLessThan(7);
    expect(Math.abs(c.y - 64)).toBeLessThan(0.01);
    expect(c.x - 20).toBeGreaterThan(100);
    expect(c.fuel).toBeLessThan(fuel0);
    expect(c.fuel).toBeGreaterThan(fuel0 - 0.1);
  });

  it('brakes from 50 km/h to a stop in roughly v² / 2a', () => {
    const { sim, ctl } = seatedSim();
    ctl.drive(1);
    for (let i = 0; i < 400 && car(sim).speed < 50 / 3.6; i++) sim.step();
    const v0 = car(sim).speed;
    const x0 = car(sim).x;
    ctl.drive(0, 1);
    let n = 0;
    while (car(sim).speed > 0.05 && n++ < 200) sim.step();
    const d = car(sim).x - x0;
    expect(d).toBeGreaterThan((v0 * v0) / (2 * 10));
    expect(d).toBeLessThan((v0 * v0) / (2 * 7) + 1.5);
  });

  it('steers along a circle and reverses on the brake from a stop', () => {
    const { sim, ctl } = seatedSim();
    ctl.drive(0.4, 0, 1);
    let maxY = 64;
    for (let i = 0; i < 8 * TPS; i++) {
      sim.step();
      maxY = Math.max(maxY, car(sim).y);
    }
    // Turning right (+y): a circle of a few metres (diameter ≈ 2 · wheelbase / tan δ, more at speed).
    expect(maxY - 64).toBeGreaterThan(5);
    expect(maxY - 64).toBeLessThan(25);
    const { sim: s2, ctl: c2 } = seatedSim();
    c2.drive(0, 1);
    runTicks(s2, 2 * TPS);
    expect(car(s2).speed).toBeLessThan(-1);
    expect(car(s2).x).toBeLessThan(20);
  });

  it('drifts with the handbrake: the rear slides and the car turns harder', () => {
    const run = (handbrake: boolean) => {
      const { sim, ctl } = seatedSim();
      ctl.drive(1);
      for (let i = 0; i < 400 && car(sim).speed < 15; i++) sim.step();
      ctl.drive(0, 0, 1, handbrake);
      let maxSlip = 0;
      const h0 = car(sim).headingRad;
      for (let i = 0; i < 12; i++) {
        sim.step();
        maxSlip = Math.max(maxSlip, car(sim).slip);
      }
      const dh = (car(sim).headingRad - h0 + 2 * Math.PI) % (2 * Math.PI);
      return { maxSlip, dh };
    };
    const grip = run(false);
    const drift = run(true);
    expect(drift.maxSlip).toBeGreaterThan(0.3);
    expect(drift.maxSlip).toBeGreaterThan(grip.maxSlip);
    expect(drift.dh).toBeGreaterThan(grip.dh);
  });

  it('engine noise is emitted with source vehicle; engine stops without fuel', () => {
    const { sim, ctl } = seatedSim({ car: { x: 20, y: 64, fuel: 0.002 } });
    ctl.drive(1);
    const events = [];
    for (let i = 0; i < 4 * TPS; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(eventsOf(events, 'engineStop').map((e) => e.reason)).toEqual(['no-fuel']);
    expect(car(sim).engineOn).toBe(false);
    expect(car(sim).fuel).toBe(0);
  });
});
