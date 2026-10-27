import { describe, expect, it } from 'vitest';
import { IMPACT, meleeDuration, meleeExtension, meleePhase, meleeProgress } from './melee-v2.js';

describe('melee v2 (anim-spec §2)', () => {
  it('lengths per weapon', () => {
    expect(meleeDuration('one_hand')).toBe(0.45);
    expect(meleeDuration(undefined)).toBe(0.45);
    expect(meleeDuration('two_hand')).toBe(0.7);
    expect(meleeDuration('knife')).toBe(0.35);
  });

  it('phases 35 / 15 / 50 %', () => {
    expect(meleePhase(0.1)).toBe('windup');
    expect(meleePhase(0.34)).toBe('windup');
    expect(meleePhase(0.36)).toBe('strike');
    expect(meleePhase(0.49)).toBe('strike');
    expect(meleePhase(0.51)).toBe('recover');
    expect(IMPACT).toBeCloseTo(0.5);
  });

  it('full reach at the impact, pulled back in the wind-up, guard at the end', () => {
    expect(meleeExtension(0)).toBeCloseTo(0);
    expect(meleeExtension(0.35)).toBeCloseTo(-0.3);
    expect(meleeExtension(IMPACT)).toBeCloseTo(1);
    expect(meleeExtension(1)).toBeCloseTo(0);
  });

  it('the sim hit lands on the end of the strike', () => {
    const d = 0.45;
    // Without a hit: plain time.
    expect(meleeProgress(0.225, d)).toBeCloseTo(0.5);
    // Hit 0.3 s after the start (late): progress at the hit is exactly IMPACT.
    expect(meleeProgress(0.3, d, 0.3)).toBeCloseTo(IMPACT);
    expect(meleePhase(meleeProgress(0.3 - 0.01, d, 0.3))).toBe('strike');
    expect(meleePhase(meleeProgress(0.3 + 0.01, d, 0.3))).toBe('recover');
    expect(meleeProgress(5, d, 0.3)).toBe(1);
  });
});
