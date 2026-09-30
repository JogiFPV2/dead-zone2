import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createIsometricCamera } from './isometric.js';
import { ROTATION_MS } from './rotation.js';
import { CameraRig } from './rig.js';

const setup = () => {
  const camera = createIsometricCamera({ aspect: 1, viewHeight: 10 });
  return { camera, rig: new CameraRig(camera, 100, { min: 0.5, max: 2, step: 1.25 }) };
};
const dir = (c: ReturnType<typeof setup>['camera']) => c.getWorldDirection(new Vector3());

describe('CameraRig', () => {
  it('starts in the classic isometric view', () => {
    const { camera } = setup();
    expect(dir(camera).distanceTo(new Vector3(-1, -1, -1).normalize())).toBeLessThan(1e-9);
  });

  it('rotates 90° after the tween and keeps the pitch', () => {
    const { camera, rig } = setup();
    rig.rotate(1, 0);
    rig.update(ROTATION_MS / 2);
    const mid = dir(camera);
    rig.update(ROTATION_MS);
    const end = dir(camera);
    expect(end.distanceTo(new Vector3(-1, -1, 1).normalize())).toBeLessThan(1e-9);
    expect(mid.y).toBeCloseTo(end.y);
  });

  it('four quarter turns return to the start', () => {
    const { camera, rig } = setup();
    for (let i = 0; i < 4; i++) rig.rotate(-1, i * 1000);
    rig.update(10_000);
    expect(dir(camera).distanceTo(new Vector3(-1, -1, -1).normalize())).toBeLessThan(1e-9);
  });

  it('zooms with the wheel within limits', () => {
    const { camera, rig } = setup();
    rig.zoomByWheel(-100);
    expect(camera.zoom).toBeCloseTo(1.25);
    rig.zoomByWheel(-10_000);
    expect(rig.zoom).toBe(2);
  });
});
