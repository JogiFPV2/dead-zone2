import { describe, expect, it } from 'vitest';
import { fixtureContent, runMinutes, send, survivalSim } from '../test/content-fixtures.js';
import { runTicks } from '../test/ai-fixtures.js';

describe('wound penalties (worldSettings.survival.woundPenalties)', () => {
  const content = fixtureContent();
  const cfg = content.worldSettings.survival.woundPenalties;
  const pen = (sim: ReturnType<typeof survivalSim>) => sim.drainView()?.player?.penalties;

  it('no wounds: no penalties, no view field', () => {
    const sim = survivalSim(content);
    sim.step();
    expect(sim.drainView()?.player?.penalties).toBeUndefined();
  });

  it('leg wound slows walking; heaviest wound per group counts, groups add up, capped', () => {
    const a = survivalSim(content);
    const b = survivalSim(content);
    send(b, { type: 'debugWound', part: 'shin_l', wound: 'scratch' });
    send(b, { type: 'debugWound', part: 'thigh_r', wound: 'deep' });
    a.step();
    b.step();
    b.step();
    const p = pen(b)!;
    // Same group (leg): the deep wound only (no sum of the scratch).
    expect(p.moveSpeed).toBeCloseTo(cfg.heavy.leg.moveSpeed, 2);
    for (const s of [a, b]) send(s, { type: 'move', dx: 1, dy: 0 });
    runTicks(a, 40);
    runTicks(b, 40);
    const da = a.getPlayer()!.x - 10.5;
    const db = b.getPlayer()!.x - 10.5;
    expect(db / da).toBeCloseTo(1 - cfg.heavy.leg.moveSpeed, 1);

    const c = survivalSim(content);
    for (const part of ['head', 'torso_upper', 'forearm_l', 'shin_r'] as const)
      send(c, { type: 'debugWound', part, wound: 'deep' });
    c.step();
    c.step();
    const q = pen(c)!;
    for (const v of [q.moveSpeed, q.attackPower, q.actionSpeed, q.visionRange])
      expect(v).toBeLessThanOrEqual(cfg.maxPenalty + 1e-6);
    expect(q.moveSpeed).toBeCloseTo(
      Math.min(
        cfg.maxPenalty,
        cfg.heavy.head.moveSpeed +
          cfg.heavy.torso.moveSpeed +
          cfg.heavy.arm.moveSpeed +
          cfg.heavy.leg.moveSpeed,
      ),
      2,
    );
  });

  it('bandaging reduces the penalty (× bandagedFactor)', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugWound', part: 'forearm_r', wound: 'laceration' });
    sim.step();
    sim.step();
    expect(pen(sim)!.attackPower).toBeCloseTo(cfg.light.arm.attackPower, 2);
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:bandage' });
    send(sim, { type: 'bandage', part: 'forearm_r', itemId: 'fixture:bandage' });
    runMinutes(sim, 5);
    expect(sim.getSurvival()!.wounds[0]!.bandaged).toBe(true);
    const after = pen(sim)!.attackPower;
    expect(after).toBeCloseTo(cfg.light.arm.attackPower * cfg.bandagedFactor, 1);
    expect(after).toBeLessThan(cfg.light.arm.attackPower);
  });

  it('pain, fever and bleeding from their threshold narrow sight and blur', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugStat', stat: 'body-temperature-c', value: 40 });
    sim.step();
    sim.step();
    const p = pen(sim)!;
    expect(p.visionRange).toBeCloseTo(cfg.conditions.fever.visionRange, 2);
    expect(p.blur).toBeCloseTo(cfg.conditions.fever.blur, 2);
    expect(p.moveSpeed).toBe(0);
  });
});
