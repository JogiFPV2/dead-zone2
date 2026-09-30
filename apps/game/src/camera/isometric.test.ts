import { describe, expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import {
  ISO_PITCH,
  createIsometricCamera,
  isometricOffset,
  orthoFrustum,
  resizeIsometricCamera,
} from './isometric.js';

const deg = (rad: number) => (rad * 180) / Math.PI;

describe('isometric camera', () => {
  it('uses the classic 35.264° pitch', () => {
    expect(deg(ISO_PITCH)).toBeCloseTo(35.264, 3);
  });

  it('places the camera along (1,1,1)', () => {
    const o = isometricOffset(Math.sqrt(3));
    expect(o.x).toBeCloseTo(1);
    expect(o.y).toBeCloseTo(1);
    expect(o.z).toBeCloseTo(1);
  });

  it('looks at the target with 45° yaw and -35.264° pitch', () => {
    const target = new Vector3(5, 0, -3);
    const cam = createIsometricCamera({ aspect: 16 / 9, viewHeight: 20, target });
    const dir = cam.getWorldDirection(new Vector3());
    const expected = new Vector3(-1, -1, -1).normalize();
    expect(dir.distanceTo(expected)).toBeLessThan(1e-9);

    const e = new Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    expect(deg(e.y)).toBeCloseTo(45, 6);
    expect(deg(e.x)).toBeCloseTo(-35.264, 3);
  });

  it('keeps the frustum proportional to aspect and updates on resize', () => {
    expect(orthoFrustum(2, 10)).toEqual({ left: -10, right: 10, top: 5, bottom: -5 });
    const cam = createIsometricCamera({ aspect: 1, viewHeight: 10 });
    resizeIsometricCamera(cam, 2, 10);
    expect(cam.right - cam.left).toBeCloseTo(20);
    expect(cam.top - cam.bottom).toBeCloseTo(10);
  });
});
