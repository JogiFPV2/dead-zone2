import { Bone, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { solveTwoBone, type ArmBones } from './arm-pose.js';

/** Straight arm along +X: shoulder at the origin, 0.3 upper, 0.25 lower. */
function arm(): ArmBones {
  const upper = new Bone();
  const lower = new Bone();
  const wrist = new Bone();
  lower.position.set(0.3, 0, 0);
  wrist.position.set(0.25, 0, 0);
  upper.add(lower);
  lower.add(wrist);
  upper.updateMatrixWorld(true);
  return { upper, lower, wrist };
}
const wristPos = (a: ArmBones) => new Vector3().setFromMatrixPosition(a.wrist.matrixWorld);
const elbowPos = (a: ArmBones) => new Vector3().setFromMatrixPosition(a.lower.matrixWorld);

describe('solveTwoBone', () => {
  it('puts the wrist on a reachable target, elbow toward the pole', () => {
    const a = arm();
    const target = new Vector3(0.2, -0.25, 0.2);
    solveTwoBone(a, target, new Vector3(0, 0, -1));
    expect(wristPos(a).distanceTo(target)).toBeLessThan(1e-3);
    expect(elbowPos(a).length()).toBeCloseTo(0.3, 4);
    expect(elbowPos(a).z).toBeLessThan(target.z);
  });

  it('stretches toward an unreachable target without breaking the bone lengths', () => {
    const a = arm();
    solveTwoBone(a, new Vector3(0, 0, 2), new Vector3(0, -1, 0));
    const w = wristPos(a);
    expect(w.length()).toBeCloseTo(0.55, 2);
    expect(w.z).toBeGreaterThan(0.54);
    expect(w.distanceTo(elbowPos(a))).toBeCloseTo(0.25, 4);
  });
});
