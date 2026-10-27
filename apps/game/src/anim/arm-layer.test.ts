import { Bone, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ARM_SWING, ArmLayer, gripSpecV2, lowReadyAngle, swingOf } from './arm-layer.js';

const bones = () => {
  const upper = new Bone();
  const lower = new Bone();
  const wrist = new Bone();
  lower.position.set(0, -0.3, 0);
  wrist.position.set(0, -0.28, 0);
  upper.add(lower);
  lower.add(wrist);
  return { upper, lower, wrist };
};

describe('arm layer (anim-spec §3)', () => {
  it('swing multipliers per category', () => {
    expect(ARM_SWING.empty).toEqual({ R: 1, L: 1 });
    expect(swingOf({})).toEqual({ R: 1, L: 1 });
    expect(swingOf({ R: 'melee1' })).toEqual({ R: 0.6, L: 1 });
    expect(swingOf({ R: 'plank' })).toEqual({ R: 0.2, L: 0.2 });
    expect(swingOf({ R: 'pistol', L: 'flashlight' })).toEqual({ R: 0.3, L: 0.25 });
    expect(swingOf({ L: 'food' })).toEqual({ R: 1, L: 0.7 });
    expect(swingOf({ R: 'bag' })).toEqual({ R: 0.35, L: 1 });
    // A flashlight alone in the right hand.
    expect(swingOf({ R: 'flashlight' })).toEqual({ R: 0.25, L: 1 });
  });

  it('low ready: pistol 45°, long guns 30° walking / 50° running', () => {
    const deg = (r: number | undefined) => ((r ?? NaN) * 180) / Math.PI;
    expect(deg(lowReadyAngle('pistol', false))).toBeCloseTo(45);
    expect(deg(lowReadyAngle('rifle', false))).toBeCloseTo(30);
    expect(deg(lowReadyAngle('rifle', true))).toBeCloseTo(50);
    expect(lowReadyAngle('two_hand', false)).toBeUndefined();
    const d = gripSpecV2('rifle', true)!.rest.dir;
    expect((Math.atan2(-d.u, d.f) * 180) / Math.PI).toBeCloseTo(50);
    expect(gripSpecV2('rifle', true)!.aim).toBeDefined();
  });

  it('a held item damps the swing of its arm towards the swing centre', () => {
    const r = bones();
    const layer = new ArmLayer(r, undefined, undefined);
    // The clip swings the arm ±40° about the rest pose (centre stays at rest).
    const x = new Vector3(1, 0, 0);
    for (let i = 0; i < 60; i++) {
      r.upper.quaternion.setFromAxisAngle(x, i % 2 ? -0.7 : 0.7);
      layer.apply({ R: 'rifle' }, 0.016);
    }
    // After blending in, the arm keeps ~10% of the swing (rifle 0.1) around the centre.
    expect(layer.multipliers.R).toBeLessThan(0.2);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(r.upper.quaternion.w)));
    expect(angle).toBeLessThan(0.7 * 0.3);
  });
});
