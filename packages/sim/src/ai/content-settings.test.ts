import {
  DEFAULT_AI_STOP_GAP_M,
  DEFAULT_ZOMBIE_CAR_REACH_M,
  DEFAULT_ZOMBIE_HIT_CHANCE,
} from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import { fixtureContent } from '../test/content-fixtures.js';
import { aiSim } from '../test/ai-fixtures.js';

const sim = (worldSettings: object = {}) =>
  aiSim({ spawn: { x: 10.5, y: 10.5 }, zombies: [], content: fixtureContent(worldSettings) });

describe('worldSettings.combat.zombie and ai.stopGapM (#295 / #298)', () => {
  it('absent: content DEFAULT_* (0.7 / 0.9 / 0.15, values unchanged)', () => {
    const w = sim().world;
    expect(w.ai!.combat.cfg.zombie).toEqual({
      hitChance: DEFAULT_ZOMBIE_HIT_CHANCE,
      carReachTiles: DEFAULT_ZOMBIE_CAR_REACH_M,
    });
    expect(w.ai!.cfg.ai.reachTiles).toBe(DEFAULT_AI_STOP_GAP_M);
    expect([DEFAULT_ZOMBIE_HIT_CHANCE, DEFAULT_ZOMBIE_CAR_REACH_M, DEFAULT_AI_STOP_GAP_M]).toEqual([
      0.7, 0.9, 0.15,
    ]);
  });

  it('present: content wins, partial fields keep the default', () => {
    const w = sim({ combat: { zombie: { hitChance: 0.2 } }, ai: { stopGapM: 0.05 } }).world;
    expect(w.ai!.combat.cfg.zombie).toEqual({
      hitChance: 0.2,
      carReachTiles: DEFAULT_ZOMBIE_CAR_REACH_M,
    });
    expect(w.ai!.cfg.ai.reachTiles).toBe(0.05);
    const c = sim({ combat: { zombie: { carReachM: 1.2 } } }).world;
    expect(c.ai!.combat.cfg.zombie.carReachTiles).toBe(1.2);
    expect(c.ai!.combat.cfg.zombie.hitChance).toBe(DEFAULT_ZOMBIE_HIT_CHANCE);
  });
});
