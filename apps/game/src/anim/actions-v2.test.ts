import { describe, expect, it } from 'vitest';
import {
  DRAW_TIME,
  HOLSTER_TIME,
  SHOT_KICK,
  SHOT_RETURN,
  USE_LOOP,
  addOffsets,
  drawState,
  holsterAt,
  reloadDuration,
  reloadOffsets,
  shotEnvelope,
  shotOffsets,
  useOffsets,
} from './actions-v2.js';

const DEG = Math.PI / 180;

describe('anim v2 P2 actions (anim-spec §2)', () => {
  it('shot: 0.12 s kick to full, 0.25 s back to rest', () => {
    expect(shotEnvelope(-0.01)).toBe(0);
    expect(shotEnvelope(0)).toBe(0);
    expect(shotEnvelope(SHOT_KICK)).toBeCloseTo(1);
    expect(shotEnvelope(SHOT_KICK + SHOT_RETURN)).toBeCloseTo(0);
    expect(shotEnvelope(1)).toBe(0);
    expect(SHOT_KICK).toBe(0.12);
    expect(SHOT_RETURN).toBe(0.25);
  });
  it('pistol kicks wrist 12° / elbow 8°, long guns push the shoulder 6 cm and torso 4°', () => {
    const p = shotOffsets('pistol', SHOT_KICK);
    expect(p.wristR).toBeCloseTo(12 * DEG);
    expect(p.elbowR).toBeCloseTo(8 * DEG);
    const r = shotOffsets('rifle', SHOT_KICK);
    expect(r.shoulderBackR).toBeCloseTo(0.06);
    expect(r.torso).toBeCloseTo(4 * DEG);
    expect(r.wristR).toBeUndefined();
    expect(shotOffsets('pistol', 2)).toEqual({});
  });
  it('reload: pistol 1.2 s, single round 0.6 s; left hand goes to the belt and back', () => {
    expect(reloadDuration(false)).toBe(1.2);
    expect(reloadDuration(true)).toBe(0.6);
    expect(reloadOffsets(0).leftToBelt).toBe(0);
    expect(reloadOffsets(0.45).leftToBelt).toBe(1);
    expect(reloadOffsets(0.99).leftToBelt).toBeLessThan(0.01);
    expect(reloadOffsets(1)).toEqual({});
  });
  it('use: eat / drink loops in 1.0 s to the mouth, bandage 1.5 s wrap', () => {
    expect(USE_LOOP).toEqual({ eat: 1, drink: 1, bandage: 1.5 });
    expect(useOffsets('eat', 0.5).leftToMouth).toBeCloseTo(1);
    expect(useOffsets('eat', 1.0).leftToMouth).toBeCloseTo(0);
    expect(useOffsets('drink', 1.5).leftToMouth).toBeCloseTo(1);
    expect(useOffsets('bandage', 0.75).wrap).toBeCloseTo(1);
    expect(useOffsets('bandage', 1.5).wrap).toBeCloseTo(0.6);
  });
  it('draw 0.4 s / holster 0.35 s, model swaps halfway, back for two-handed', () => {
    expect(DRAW_TIME).toBe(0.4);
    expect(HOLSTER_TIME).toBe(0.35);
    expect(drawState('draw', 'pistol', 0.19).swapped).toBe(false);
    expect(drawState('draw', 'pistol', 0.2).swapped).toBe(true);
    expect(drawState('holster', 'knife', 0.175).offsets.holster).toBeCloseTo(1);
    expect(drawState('draw', 'two_hand', 0.4)).toEqual({ k: 1, swapped: true, offsets: {} });
    expect(holsterAt('two_hand')).toBe('back');
    expect(holsterAt('rifle')).toBe('back');
    expect(holsterAt('pistol')).toBe('belt');
    expect(holsterAt('knife')).toBe('belt');
  });
  it('offsets add up', () => {
    expect(addOffsets({ torso: 1 }, { torso: 2, holsterAt: 'back' })).toEqual({
      torso: 3,
      holsterAt: 'back',
    });
  });
});
