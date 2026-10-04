import { describe, expect, it } from 'vitest';
import { compileContent } from '../content/adapter.js';
import { fixtureContent, runMinutes, send, survivalSim } from '../test/content-fixtures.js';
import { nextMoodleLevel } from './moodles.js';

describe('moodles', () => {
  const content = fixtureContent();
  const index = compileContent(content);
  const hunger = index.moodles[index.moodleIndex.get('fixture:hunger')!]!;
  const cold = index.moodles[index.moodleIndex.get('fixture:cold')!]!;

  it('compiles moodles sorted by id with f32 thresholds', () => {
    expect(index.moodles.map((m) => m.id)).toEqual([
      'fixture:bleeding',
      'fixture:carry',
      'fixture:cold',
      'fixture:fatigue',
      'fixture:hunger',
    ]);
    expect(cold.enterAt[0]).toBe(Math.fround(36));
    expect(index.coldMoodles).toEqual([2]);
    expect([...index.bandageItems]).toEqual(['fixture:bandage', 'fixture:quick-bandage']);
  });

  it('rising: enters at enterAt, leaves only below exitAt (hysteresis), can jump levels', () => {
    expect(nextMoodleLevel(hunger, 0, 24.9)).toBe(0);
    expect(nextMoodleLevel(hunger, 0, 25)).toBe(1);
    expect(nextMoodleLevel(hunger, 1, 21)).toBe(1);
    expect(nextMoodleLevel(hunger, 1, 19.9)).toBe(0);
    expect(nextMoodleLevel(hunger, 0, 60)).toBe(2);
    expect(nextMoodleLevel(hunger, 2, 46)).toBe(2);
    expect(nextMoodleLevel(hunger, 2, 10)).toBe(0);
  });

  it('falling (cold): level rises as the stat drops', () => {
    expect(nextMoodleLevel(cold, 0, 37)).toBe(0);
    expect(nextMoodleLevel(cold, 0, 36)).toBe(1);
    expect(nextMoodleLevel(cold, 1, 36.2)).toBe(1);
    expect(nextMoodleLevel(cold, 1, 36.4)).toBe(0);
    expect(nextMoodleLevel(cold, 0, 34)).toBe(2);
  });

  it('follows stats in the sim and emits moodleChanged only on change', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugStat', stat: 'hunger', value: 26 });
    sim.step();
    expect(sim.getSurvival()!.moodles).toEqual({ 'fixture:hunger': 1 });
    send(sim, { type: 'debugStat', stat: 'hunger', value: 21 });
    sim.step();
    send(sim, { type: 'debugStat', stat: 'hunger', value: 5 });
    sim.step();
    const changes = sim.drainEvents().filter((e) => e.type === 'moodleChanged');
    expect(changes).toEqual([
      { type: 'moodleChanged', tick: 0, playerId: 0, moodle: 'fixture:hunger', from: 0, to: 1 },
      { type: 'moodleChanged', tick: 2, playerId: 0, moodle: 'fixture:hunger', from: 1, to: 0 },
    ]);
  });

  it('moodles on stats the sim does not track stay hidden (carry-load)', () => {
    const sim = survivalSim(content);
    runMinutes(sim, 2);
    expect(sim.getSurvival()!.moodles['fixture:carry']).toBeUndefined();
  });

  it('level modifiers apply: fatigue level 2 halves move speed (move-speed ×0.5)', () => {
    const rested = survivalSim(content);
    const tired = survivalSim(content);
    send(tired, { type: 'debugStat', stat: 'fatigue', value: 85 });
    // Moodles run after movement, so the modifier applies from the next tick.
    rested.step();
    tired.step();
    const x0 = { rested: rested.getPlayer()!.x, tired: tired.getPlayer()!.x };
    for (const sim of [rested, tired]) send(sim, { type: 'move', dx: 1, dy: 0 });
    for (let i = 0; i < 20; i++) {
      rested.step();
      tired.step();
    }
    expect(tired.getSurvival()!.moodles['fixture:fatigue']).toBe(2);
    expect(tired.getPlayer()!.x).toBeGreaterThan(x0.tired);
    // Steady speeds (the jerk-limited start takes a different time to each target speed).
    const at = { rested: rested.getPlayer()!.x, tired: tired.getPlayer()!.x };
    for (let i = 0; i < 10; i++) {
      rested.step();
      tired.step();
    }
    const dx = (sim: typeof rested) => sim.getPlayer()!.x - (sim === tired ? at.tired : at.rested);
    expect(dx(tired) / dx(rested)).toBeCloseTo(0.5, 4);
  });

  it('bleeding moodle turns on right after a wound command', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugWound', part: 'shin_l', wound: 'scratch' });
    sim.step();
    expect(sim.getSurvival()!.moodles['fixture:bleeding']).toBe(1);
  });
});
