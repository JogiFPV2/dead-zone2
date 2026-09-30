import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import {
  baseContent,
  fixtureContent,
  runMinutes,
  send,
  survivalSim,
  TICKS_PER_MIN,
} from '../test/content-fixtures.js';

const stats = (sim: ReturnType<typeof survivalSim>) => sim.getSurvival()!.stats;

describe('survival: needs (rates per game minute from worldSettings.survival)', () => {
  const content = fixtureContent();
  const cfg = content.worldSettings.survival;

  it('starts from the data: health 100, endurance 100, body 37 °C, 80 kg', () => {
    const s = stats(survivalSim(content));
    expect(s.health).toBe(100);
    expect(s.endurance).toBe(100);
    expect(s['body-temperature-c']).toBe(cfg.temperature.bodyBaseC);
    expect(s['body-weight-kg']).toBe(cfg.nutrition.startBodyWeightKg);
    expect(s.hunger).toBe(0);
  });

  it('idle: hunger, thirst and fatigue grow by the base rates each game minute', () => {
    const sim = survivalSim(content);
    runMinutes(sim, 101); // 100 minute boundaries
    const s = stats(sim);
    expect(s.hunger).toBeCloseTo(100 * cfg.needs.hungerPerMin, 3);
    expect(s.thirst).toBeCloseTo(100 * cfg.needs.thirstPerMin, 3);
    expect(s.fatigue).toBeCloseTo(100 * cfg.needs.fatiguePerMin, 3);
    expect(s.boredom).toBeCloseTo(100 * cfg.boredom.idleGainPerMin, 3);
    const burn = (100 * cfg.nutrition.dailyBurnKcal) / 1440 / cfg.nutrition.kcalPerKg;
    expect(s['body-weight-kg']).toBeCloseTo(cfg.nutrition.startBodyWeightKg - burn, 4);
  });

  it('stats change only on game-minute boundaries', () => {
    const sim = survivalSim(content);
    for (let i = 0; i < TICKS_PER_MIN; i++) sim.step();
    expect(stats(sim).hunger).toBe(0);
    sim.step();
    expect(stats(sim).hunger).toBeGreaterThan(0);
  });

  it('walking uses the walking activity multipliers and lowers boredom', () => {
    const idle = survivalSim(content);
    const walk = survivalSim(content);
    send(walk, { type: 'debugStat', stat: 'boredom', value: 50 });
    send(idle, { type: 'debugStat', stat: 'boredom', value: 50 });
    send(walk, { type: 'move', dx: 1, dy: 0 });
    runMinutes(idle, 11);
    runMinutes(walk, 11);
    const a = cfg.activity.walking;
    expect(stats(walk).hunger / stats(idle).hunger).toBeCloseTo(a.hunger, 4);
    expect(stats(walk).thirst / stats(idle).thirst).toBeCloseTo(a.thirst, 4);
    expect(stats(walk).boredom).toBeLessThan(50);
    expect(stats(idle).boredom).toBeGreaterThan(50);
  });

  it('stress from needs above the threshold, then unhappiness; both decay otherwise', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugStat', stat: 'hunger', value: 60 });
    runMinutes(sim, 11);
    expect(stats(sim).stress).toBeCloseTo(10 * cfg.stress.fromNeedsPerMin, 4);
    send(sim, { type: 'debugStat', stat: 'hunger', value: 0 });
    send(sim, { type: 'debugStat', stat: 'stress', value: 60 });
    runMinutes(sim, 10);
    expect(stats(sim).stress).toBeCloseTo(60 - 10 * cfg.stress.decayPerMin, 3);
    expect(stats(sim).unhappiness).toBeCloseTo(10 * cfg.unhappiness.stressGainPerMin, 4);
  });

  it('body temperature: cold ambient cools, comfort returns to base, wetness feels colder', () => {
    const cold = survivalSim(content, { ambientTemperatureC: 8 });
    runMinutes(cold, 11);
    const t = cfg.temperature;
    expect(stats(cold)['body-temperature-c']).toBeCloseTo(
      t.bodyBaseC - 10 * t.coolingPerDegPerMin * (t.comfortMinC - 8),
      3,
    );
    const warm = survivalSim(content);
    send(warm, { type: 'debugStat', stat: 'body-temperature-c', value: 36 });
    runMinutes(warm, 11);
    expect(stats(warm)['body-temperature-c']).toBeCloseTo(36 + 10 * t.recoveryPerMin, 3);
    const wet = survivalSim(content, { ambientTemperatureC: 19 });
    send(wet, { type: 'debugStat', stat: 'wetness', value: 100 });
    runMinutes(wet, 2);
    expect(stats(wet)['body-temperature-c']).toBeLessThan(t.bodyBaseC);
    expect(stats(wet).wetness).toBeCloseTo(100 - cfg.wetness.dryOutdoorsPerMin, 4);
  });

  it('starvation and dehydration hurt from their thresholds; death has the right cause', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugStat', stat: 'thirst', value: 95 });
    runMinutes(sim, 11);
    expect(stats(sim).health).toBeCloseTo(100 - 10 * cfg.health.dehydration.healthLossPerMin, 3);
    send(sim, { type: 'debugStat', stat: 'health', value: 0.5 });
    runMinutes(sim, 10);
    const died = sim.drainEvents().filter((e) => e.type === 'died');
    expect(died).toHaveLength(1);
    expect(died[0]).toMatchObject({ cause: 'dehydration', playerId: 0, day: 1 });
    expect(sim.getSurvival()!.alive).toBe(false);
  });

  it('health regenerates only when fed and watered', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugStat', stat: 'health', value: 50 });
    runMinutes(sim, 11);
    expect(stats(sim).health).toBeCloseTo(50 + 10 * cfg.health.regenPerMin, 3);
    send(sim, { type: 'debugStat', stat: 'hunger', value: 60 });
    const hp = stats(sim).health;
    runMinutes(sim, 10);
    expect(stats(sim).health).toBe(hp);
  });

  it('base pack: without food and water the character dies of thirst in 2–4 game days', async () => {
    const sim = survivalSim(await baseContent());
    let died: SimEvent | undefined;
    for (let day = 0; day < 5 && !died; day++) {
      runMinutes(sim, 1440);
      died = sim.drainEvents().find((e) => e.type === 'died');
    }
    expect(died).toMatchObject({ type: 'died', cause: 'dehydration' });
    const days = (died?.tick ?? 0) / (1440 * TICKS_PER_MIN);
    expect(days).toBeGreaterThan(2);
    expect(days).toBeLessThan(4);
  });
});
