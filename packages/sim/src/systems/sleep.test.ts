import { describe, expect, it } from 'vitest';
import { fixtureContent, runMinutes, send, survivalSim } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';

describe('sleep', () => {
  const content = fixtureContent();
  const cfg = content.worldSettings.survival.sleep;
  const noCapContent = fixtureContent({
    survival: {
      sleep: { surfaces: { floor: { fatigueRecoveryPerMin: 0.05, maxRecoveryPerSleep: 100 } } },
    },
  });

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
    const sim = survivalSim(noCapContent);
    const awake = survivalSim(noCapContent);
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
    const sim = survivalSim(noCapContent);
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

describe('sleep: place, limit per sleep, save after 2 real minutes', () => {
  const content = fixtureContent();
  const cfg = content.worldSettings.survival.sleep;
  const saveTicks = cfg.saveAfterRealSec * 20;
  const withObject = (contentId: string) =>
    survivalSim(content, { map: buildMap({ objects: [{ contentId, x: 11, y: 10 }] }) });

  const recovered = (sim: ReturnType<typeof survivalSim>) => {
    send(sim, { type: 'debugStat', stat: 'fatigue', value: 100 });
    send(sim, { type: 'sleep' });
    for (let i = 0; i < 40; i++) {
      runMinutes(sim, 60);
      if (!sim.getSurvival()!.sleeping) break;
    }
    return 100 - sim.getSurvival()!.stats.fatigue;
  };

  it('floor 25, sofa 35, bed 50 fatigue per sleep, then wakes rested', () => {
    // Net drop: the recovery cap minus the little fatigue gained meanwhile (activity.sleeping).
    for (const [surf, sim] of [
      ['floor', survivalSim(content)],
      ['sofa', withObject('fixture:sofa')],
      ['bed', withObject('fixture:bed')],
    ] as const) {
      const max = cfg.surfaces[surf].maxRecoveryPerSleep;
      const r = recovered(sim);
      expect(r).toBeLessThanOrEqual(max);
      expect(r).toBeGreaterThan(max - 4);
      expect(sim.getSurvival()!.sleeping).toBe(false);
    }
  });

  it('emits sleepSaved once after saveAfterRealSec of uninterrupted sleep', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugStat', stat: 'fatigue', value: 90 });
    send(sim, { type: 'sleep' });
    const saved: number[] = [];
    for (let i = 0; i < saveTicks + 200; i++) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'sleepSaved') saved.push(e.tick);
    }
    expect(saved).toEqual([saveTicks - 1]);
  });

  it('interrupted sleep: no save, partial rest kept', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugStat', stat: 'fatigue', value: 90 });
    send(sim, { type: 'sleep' });
    let saved = 0;
    for (let i = 0; i < saveTicks - 100; i++) {
      sim.step();
      saved += sim.drainEvents().filter((e) => e.type === 'sleepSaved').length;
    }
    send(sim, { type: 'wake' });
    send(sim, { type: 'sleep' });
    for (let i = 0; i < 200; i++) {
      sim.step();
      saved += sim.drainEvents().filter((e) => e.type === 'sleepSaved').length;
    }
    expect(saved).toBe(0);
    expect(sim.getSurvival()!.stats.fatigue).toBeLessThan(90);
  });

  it('fever wakes up', () => {
    const fever = survivalSim(content);
    send(fever, { type: 'debugStat', stat: 'fatigue', value: 90 });
    send(fever, { type: 'sleep' });
    fever.step();
    send(fever, { type: 'debugStat', stat: 'body-temperature-c', value: cfg.wakeOnFeverC + 0.5 });
    fever.step();
    fever.step();
    expect(fever.drainEvents().some((e) => e.type === 'wokeUp' && e.reason === 'fever')).toBe(true);
  });
});
