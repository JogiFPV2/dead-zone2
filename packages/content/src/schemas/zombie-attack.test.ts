import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ZOMBIE_ATTACK_REACH_M,
  DEFAULT_ZOMBIE_WINDUP_MS,
  ZombieAttackReachSchema,
  ZombieWindupMsSchema,
} from './zombie-attack.js';

describe('zombie attack schema', () => {
  it('defaults are valid', () => {
    expect(ZombieAttackReachSchema.safeParse(DEFAULT_ZOMBIE_ATTACK_REACH_M).success).toBe(true);
    expect(ZombieWindupMsSchema.safeParse(DEFAULT_ZOMBIE_WINDUP_MS).success).toBe(true);
    expect(DEFAULT_ZOMBIE_ATTACK_REACH_M).toBe(0.3);
    expect(DEFAULT_ZOMBIE_WINDUP_MS).toEqual({ min: 500, max: 800 });
  });

  it('attackReachM: >0 and ≤1.5', () => {
    expect(ZombieAttackReachSchema.safeParse(1.5).success).toBe(true);
    expect(ZombieAttackReachSchema.safeParse(0).success).toBe(false);
    expect(ZombieAttackReachSchema.safeParse(1.6).success).toBe(false);
  });

  it('windupMs: positive ints, min ≤ max, strict', () => {
    expect(ZombieWindupMsSchema.safeParse({ min: 600, max: 600 }).success).toBe(true);
    expect(ZombieWindupMsSchema.safeParse({ min: 900, max: 800 }).success).toBe(false);
    expect(ZombieWindupMsSchema.safeParse({ min: 0, max: 800 }).success).toBe(false);
    expect(ZombieWindupMsSchema.safeParse({ min: 500.5, max: 800 }).success).toBe(false);
    expect(ZombieWindupMsSchema.safeParse({ min: 500, max: 800, x: 1 }).success).toBe(false);
  });
});
