import { describe, expect, it } from 'vitest';
import { approachAngle, gaitClip, targetYaw, wrapAngle } from './locomotion.js';

const PI = Math.PI;

describe('locomotion', () => {
  it('wraps angles to (−π, π]', () => {
    expect(wrapAngle(3 * PI)).toBeCloseTo(PI);
    expect(wrapAngle(-PI / 2 - 2 * PI)).toBeCloseTo(-PI / 2);
  });

  it('faces the movement when not aiming, the cursor when aiming', () => {
    // Cursor behind (facing −x), moving +x.
    expect(targetYaw({ facing: PI, vx: 2, vy: 0, aiming: false }, 0)).toBeCloseTo(0);
    expect(targetYaw({ facing: PI, vx: 2, vy: 0, aiming: true }, 0)).toBeCloseTo(PI);
    // Idle without aiming keeps the current yaw.
    expect(targetYaw({ facing: PI, vx: 0, vy: 0, aiming: false }, 1)).toBe(1);
  });

  it('never walks forward while moving backwards (owner bug)', () => {
    expect(gaitClip(PI, 2, 0)).toBe('back');
    expect(gaitClip(0, 2, 0)).toBe('walk');
    expect(gaitClip(0, 4, 0)).toBe('run');
    expect(gaitClip(0, 0.1, 0)).toBe('idle');
  });

  it('strafes to the body side: +y is the right of a body facing +x', () => {
    expect(gaitClip(0, 0, 2)).toBe('strafeRight');
    expect(gaitClip(0, 0, -2)).toBe('strafeLeft');
  });

  it('turns smoothly along the shortest arc', () => {
    const a = approachAngle(PI - 0.1, -PI + 0.1, 16);
    expect(Math.abs(wrapAngle(a - PI))).toBeLessThan(0.1);
    expect(approachAngle(0, 1, 0)).toBe(0);
    expect(approachAngle(0, 1, 1000)).toBeCloseTo(1, 3);
  });
});
