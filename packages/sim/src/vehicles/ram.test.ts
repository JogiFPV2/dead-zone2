import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VEHICLE_CONFIG } from './config.js';
import { ramReaction } from './ram.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { car, seatedSim, type VehicleSimOptions } from '../test/vehicle-fixtures.js';

const cfg = DEFAULT_VEHICLE_CONFIG;

/**
 * Cruise control at `speed` m/s (proportional throttle) until the car passes x = 45, then
 * coasts; a zombie (if any) stands ahead at x = 45. Returns the zombie's StableId too.
 */
function ram(
  speed: number,
  opts: VehicleSimOptions = { zombies: [{ x: 45, y: 64, type: 'fixture:dummy' }] },
  ticks = 200,
) {
  const { sim, ctl } = seatedSim(opts);
  const zid = sim.getZombies()[0]?.stableId ?? 0;
  const events: SimEvent[] = [...sim.drainEvents()];
  const speeds: number[] = [];
  let cruise = true;
  for (let i = 0; i < ticks; i++) {
    if (cruise && car(sim).x > 45) {
      cruise = false;
      ctl.drive(0);
    } else if (cruise) ctl.drive(Math.max(0, Math.min(1, (speed - car(sim).speed) * 2)));
    sim.step();
    speeds.push(car(sim).speed);
    events.push(...sim.drainEvents());
  }
  return { sim, events, speeds, zid };
}

const physicsOf = (events: SimEvent[], kind: string, entity: number) =>
  eventsOf(events, 'physics').filter((e) => e.kind === kind && e.entity === entity);

describe('vehicles: ramming', () => {
  it('thresholds are in m/s: push < stagger < knock-down < kill', () => {
    expect(ramReaction(1, cfg)).toBe('push');
    expect(ramReaction(cfg.ramStaggerSpeed, cfg)).toBe('stagger');
    expect(ramReaction(cfg.ramKnockdownSpeed, cfg)).toBe('knockdown');
    expect(ramReaction(cfg.ramKillSpeed, cfg)).toBe('kill');
    // Walking is 1.5 m/s, a car at walking pace only shoves.
    expect(cfg.ramStaggerSpeed).toBeGreaterThanOrEqual(1.5);
  });

  it('low speed: the zombie staggers and stays alive', () => {
    const { sim, events, zid } = ram(2.5);
    expect(physicsOf(events, 'staggered', zid).length).toBeGreaterThan(0);
    expect(physicsOf(events, 'fellDown', zid)).toEqual([]);
    expect(sim.getZombies()[0]!.hp).toBeGreaterThan(0);
    expect(eventsOf(events, 'zombieKilled')).toEqual([]);
    expect(eventsOf(events, 'vehicleImpact').some((e) => e.targetKind === 'zombie')).toBe(true);
  });

  it('medium speed: knock-down, the car rolls over the body and loses speed', () => {
    const hit = ram(5.5);
    expect(physicsOf(hit.events, 'fellDown', hit.zid).length).toBe(1);
    expect(eventsOf(hit.events, 'zombieKilled')).toEqual([]);
    const free = ram(5.5, {});
    // Same run without the zombie: the body (impact + under the wheels) cost speed.
    const last = hit.speeds.length - 1;
    expect(hit.speeds[last]!).toBeLessThan(free.speeds[last]! - 0.5);
    // The car went over it (it is behind the car now).
    const z = hit.sim.getZombies()[0]!;
    expect(z.x).toBeLessThan(car(hit.sim).x);
  });

  it('a knocked-down zombie run over fast enough is crushed', () => {
    const { events, zid } = ram(8);
    expect(physicsOf(events, 'fellDown', zid).length).toBe(1);
    expect(eventsOf(events, 'zombieKilled').map((e) => e.zombie)).toEqual([zid]);
  });

  it('high speed: the zombie dies at once, the driver gets the kill (hit source vehicle)', () => {
    const { events, zid } = ram(11);
    const z = { stableId: zid };
    const killed = eventsOf(events, 'zombieKilled');
    expect(killed.map((e) => e.zombie)).toEqual([z.stableId]);
    expect(killed[0]!.playerId).toBe(0);
    const hits = eventsOf(events, 'hit').filter((e) => e.target === z.stableId);
    expect(hits.map((e) => e.source)).toEqual(['vehicle']);
    expect(physicsOf(events, 'died', z.stableId).length).toBe(1);
    const impact = eventsOf(events, 'vehicleImpact').find((e) => e.targetKind === 'zombie')!;
    expect(impact.target).toBe(z.stableId);
    expect(impact.nx).toBeLessThan(-0.5);
  });
});
