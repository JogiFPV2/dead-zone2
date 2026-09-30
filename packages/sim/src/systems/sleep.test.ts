import { describe, expect, it } from 'vitest';
import { fixtureContent, runMinutes, send, survivalSim } from '../test/content-fixtures.js';

describe('sleep', () => {
  const content = fixtureContent();
  const cfg = content.worldSettings.survival.sleep;

  it('needs fatigue ≥ minFatigueToSleep', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'sleep' });
    send(sim, { type: 'wake' });
    sim.step();
    const reasons = sim
      .drainEvents()
      .flatMap((e) => (e.type === 'commandRejected' ? [e.reason] : []));
    expect(reasons).toEqual(['invalid-state', 'invalid-state']);
    expect(sim.getSurvival()!.sleeping).toBe(false);
  });

  it('asleep: fatigue recovers at the floor rate, no movement, time-scale hint; wake on command', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugStat', stat: 'fatigue', value: 60 });
    send(sim, { type: 'sleep' });
    send(sim, { type: 'move', dx: 1, dy: 0 });
    sim.step();
    const own = (s: typeof sim) => s.drainEvents().filter((e) => e.type !== 'moodleChanged');
    expect(own(sim)).toEqual([
      { type: 'fellAsleep', tick: 0, playerId: 0 },
      { type: 'timeScaleHint', tick: 0, speed: cfg.timeScaleHint },
    ]);
    const x = sim.getPlayer()!.x;
    runMinutes(sim, 10);
    expect(sim.getPlayer()!.x).toBe(x);
    expect(sim.getSurvival()!.stats.fatigue).toBeCloseTo(
      60 - 10 * cfg.surfaces.floor.fatigueRecoveryPerMin,
      4,
    );
    send(sim, { type: 'wake' });
    sim.step();
    expect(own(sim)).toEqual([
      { type: 'wokeUp', tick: sim.tick - 1, playerId: 0, reason: 'command' },
      { type: 'timeScaleHint', tick: sim.tick - 1, speed: 1 },
    ]);
    sim.step();
    expect(sim.getPlayer()!.x).toBeGreaterThan(x);
  });

  it('sleep slows needs (activity.sleeping) and wakes up rested at wakeAtFatigue', () => {
    const sim = survivalSim(content);
    const awake = survivalSim(content);
    send(sim, { type: 'debugStat', stat: 'fatigue', value: 31 });
    send(sim, { type: 'sleep' });
    const minutes = Math.ceil((31 - cfg.wakeAtFatigue) / cfg.surfaces.floor.fatigueRecoveryPerMin);
    runMinutes(sim, minutes - 5);
    runMinutes(awake, minutes - 5);
    expect(sim.getSurvival()!.sleeping).toBe(true);
    const act = content.worldSettings.survival.activity.sleeping;
    expect(sim.getSurvival()!.stats.hunger / awake.getSurvival()!.stats.hunger).toBeCloseTo(
      act.hunger,
      3,
    );
    runMinutes(sim, 10);
    expect(sim.getSurvival()!.sleeping).toBe(false);
    expect(sim.drainEvents().find((e) => e.type === 'wokeUp')).toMatchObject({ reason: 'rested' });
  });

  it('wakes after maxDurationMin', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugStat', stat: 'fatigue', value: 100 });
    send(sim, { type: 'sleep' });
    runMinutes(sim, cfg.maxDurationMin + 2);
    expect(sim.drainEvents().find((e) => e.type === 'wokeUp')).toMatchObject({
      reason: 'max-duration',
    });
  });

  it('pain lowers sleep quality', () => {
    const calm = survivalSim(content);
    const hurt = survivalSim(content);
    for (const sim of [calm, hurt]) send(sim, { type: 'debugStat', stat: 'fatigue', value: 90 });
    send(hurt, { type: 'debugWound', part: 'torso_upper', wound: 'deep' });
    send(hurt, { type: 'bandage', part: 'torso_upper' });
    for (const sim of [calm, hurt]) send(sim, { type: 'sleep' });
    runMinutes(calm, 11);
    runMinutes(hurt, 11);
    const rec = (sim: typeof calm) => 90 - sim.getSurvival()!.stats.fatigue;
    expect(rec(hurt) / rec(calm)).toBeCloseTo(cfg.painQualityMul, 3);
  });
});
