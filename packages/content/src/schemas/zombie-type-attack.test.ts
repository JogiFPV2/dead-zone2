import { describe, expect, it } from 'vitest';
import { ZombieTypeSchema } from './zombie-type.js';

const base = {
  id: 'base:test-zombie',
  name: 'zombie.test',
  tags: [],
  health: 10,
  speed: { wanderTilesPerSec: 0.5, chaseTilesPerSec: 1 },
  damage: { min: 1, max: 2 },
  attackCooldownSec: 1,
  biteChance: 0.1,
  sightRangeTiles: 10,
  hearingRangeTiles: 10,
};

describe('ZombieTypeSchema attackReachM + windupMs', () => {
  it('fields are optional', () => {
    const r = ZombieTypeSchema.safeParse(base);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(r.data?.attackReachM).toBeUndefined();
  });
  it('accepts valid values', () => {
    const r = ZombieTypeSchema.safeParse({
      ...base,
      attackReachM: 0.4,
      windupMs: { min: 400, max: 700 },
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
  it('rejects invalid values', () => {
    expect(ZombieTypeSchema.safeParse({ ...base, attackReachM: 2 }).success).toBe(false);
    expect(ZombieTypeSchema.safeParse({ ...base, windupMs: { min: 800, max: 500 } }).success).toBe(
      false,
    );
  });
});
