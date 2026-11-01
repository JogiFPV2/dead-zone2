import { describe, expect, it } from 'vitest';
import { FORCED_STAGGER_TICKS, forcedAttack, forcedKnockback, parseDevForce } from './dev-force.js';
import type { PhysState } from '../anim/contract.js';

const q = (s: string) => new URLSearchParams(s);

describe('dev ?force=', () => {
  it('parses the kinds and clamps k, ignores the rest', () => {
    expect(parseDevForce(q('force=reload&k=0.3'))).toEqual({ kind: 'reload', k: 0.3 });
    expect(parseDevForce(q('force=attack&k=7'))).toEqual({ kind: 'attack', k: 1 });
    expect(parseDevForce(q('force=knockback'))).toEqual({ kind: 'knockback', k: 0.5 });
    expect(parseDevForce(q('force=dance'))).toBeUndefined();
    expect(parseDevForce(undefined)).toBeUndefined();
  });
  it('forced knockback = a full-strength stagger started k of the way back', () => {
    const p = { facing: 0, state: 'idle', stateStartTick: 0 } as unknown as PhysState;
    const s = forcedKnockback(p, 100, 0.5);
    expect(s.state).toBe('stagger');
    expect(s.stateStartTick).toBe(100 - FORCED_STAGGER_TICKS / 2);
    expect(s.knockback.strength).toBe(1);
    expect(s.hitFromDir).toBeCloseTo(Math.PI);
  });
  it('forced attack keeps the body in the attack state', () => {
    const p = { facing: 0, state: 'idle', stateStartTick: 0 } as unknown as PhysState;
    expect(forcedAttack(p, 50.4).state).toBe('attack');
  });
});
