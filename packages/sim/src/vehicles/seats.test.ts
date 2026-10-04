import { ENTITY_PHYS_STATES, SnapshotField, type SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { eventsOf, runTicks } from '../test/ai-fixtures.js';
import { car, controls, seatedSim, vehicleSim } from '../test/vehicle-fixtures.js';

const DRIVING = ENTITY_PHYS_STATES.indexOf('driving');

function playerRow(sim: ReturnType<typeof vehicleSim>) {
  const f = new Float32Array(sim.snapshot());
  const sid = 1;
  for (let o = 0; o < f.length; o += 17) {
    if (f[o + SnapshotField.stableId] === sid)
      return { x: f[o + 1]!, y: f[o + 2]!, state: f[o + SnapshotField.state]! };
  }
  throw new Error('no player row');
}

const drain = (sim: ReturnType<typeof vehicleSim>, n: number): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    out.push(...sim.drainEvents());
  }
  return out;
};

describe('vehicles: enter / exit (instant stub)', () => {
  it('`driving` is the last physics state (appended, indices unchanged)', () => {
    expect(ENTITY_PHYS_STATES[ENTITY_PHYS_STATES.length - 1]).toBe('driving');
    expect(ENTITY_PHYS_STATES.indexOf('vault')).toBe(12);
    expect(DRIVING).toBe(13);
  });

  it('enters at the driver door: state driving, pinned to the seat, engine starts, view seat', () => {
    const sim = vehicleSim();
    sim.drainView();
    const ctl = controls(sim);
    ctl.enter(car(sim).stableId);
    const ev = drain(sim, 1);
    const c = car(sim);
    expect(eventsOf(ev, 'vehicleEnter')).toMatchObject([
      { vehicleId: c.stableId, seat: 0, entity: 1 },
    ]);
    expect(eventsOf(ev, 'engineStart')).toHaveLength(1);
    expect(c.occupants[0]).toBe(1);
    expect(c.engineOn).toBe(true);
    expect(c.doorsOpen & 1).toBe(1);
    const p = playerRow(sim);
    expect(p.state).toBe(DRIVING);
    // Driver seat: 0.1 m forward, 0.4 m left of the centre (heading +x → left = −y).
    expect(p.x).toBeCloseTo(c.x + 0.1, 4);
    expect(p.y).toBeCloseTo(c.y - 0.4, 4);
    expect(sim.drainView()?.player?.vehicle).toEqual({ vehicleId: c.stableId, seat: 0 });
    // The door closes again after `doorOpenTicks`.
    runTicks(sim, 12);
    expect(car(sim).doorsOpen).toBe(0);
  });

  it('rejects: too far from the door, a taken seat, no such seat, moving car', () => {
    const far = vehicleSim({ spawn: { x: 30, y: 64 } });
    const c1 = controls(far);
    c1.enter(car(far).stableId);
    expect(eventsOf(drain(far, 1), 'commandRejected')[0]?.reason).toBe('out-of-range');

    const sim = vehicleSim();
    const ctl = controls(sim);
    ctl.enter(car(sim).stableId, 9);
    expect(eventsOf(drain(sim, 1), 'commandRejected')[0]?.reason).toBe('invalid-target');

    const { sim: s2, ctl: k2 } = seatedSim();
    k2.drive(1);
    runTicks(s2, 40);
    k2.exit();
    expect(eventsOf(drain(s2, 1), 'commandRejected')[0]?.reason).toBe('invalid-state');
  });

  it('walking is ignored while seated; exit puts the player at the door and stops the engine', () => {
    const { sim, ctl } = seatedSim();
    sim.drainEvents();
    sim.drainView();
    const c0 = car(sim);
    ctl.move(1, 0);
    runTicks(sim, 20);
    expect(playerRow(sim).x).toBeCloseTo(c0.x + 0.1, 4);
    ctl.exit();
    const ev = drain(sim, 1);
    expect(eventsOf(ev, 'vehicleExit')).toMatchObject([{ seat: 0, entity: 1 }]);
    expect(eventsOf(ev, 'engineStop').map((e) => e.reason)).toEqual(['driver-left']);
    const c = car(sim);
    expect(c.occupants).toEqual([0, 0, 0, 0]);
    expect(c.engineOn).toBe(false);
    expect(c.handbrake).toBe(true);
    const p = playerRow(sim);
    expect(p.state).not.toBe(DRIVING);
    // Door point: 0.9 m (half width) + 0.4 m outside the left side.
    expect(p.y).toBeLessThan(c.y - 1.2);
    expect(sim.drainView()?.player?.vehicle).toBeNull();
  });

  it('exit is refused when a wall blocks the door side (free exit path)', () => {
    // Wall on the north edge of row 65: between the passenger seat (y 64.4) and its door (65.3).
    const sim = vehicleSim({
      map: { wallN: (_x: number, y: number) => y === 65 },
      spawn: { x: 20.1, y: 65.4 },
    });
    const ctl = controls(sim);
    ctl.enter(car(sim).stableId, 1);
    expect(eventsOf(drain(sim, 1), 'vehicleEnter')).toHaveLength(1);
    ctl.exit();
    expect(eventsOf(drain(sim, 1), 'commandRejected').map((e) => e.reason)).toEqual(['no-space']);
    expect(car(sim).occupants[1]).toBe(1);
  });
});
