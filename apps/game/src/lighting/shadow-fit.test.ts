import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createIsometricCamera, isometricOffset } from '../camera/isometric.js';
import {
  DEFAULT_SHADOW_FIT,
  fitShadowFrustum,
  viewFootprint,
  type ShadowFit,
} from './shadow-fit.js';

const LIGHT = new Vector3(-30, 50, 20).normalize();

function camera(target = new Vector3(), zoom = 1, aspect = 16 / 9) {
  const c = createIsometricCamera({ aspect, viewHeight: 24, target });
  c.zoom = zoom;
  c.updateProjectionMatrix();
  return c;
}

/** Point in the fitted shadow camera's space (x, y across, z = -depth from the light). */
function inShadowSpace(fit: ShadowFit, p: Vector3): Vector3 {
  const view = new Matrix4().lookAt(fit.position, fit.target, new Vector3(0, 1, 0));
  view.setPosition(fit.position);
  return p.clone().applyMatrix4(view.invert());
}

describe('viewFootprint', () => {
  it('returns 8 points on the two slab planes around the target', () => {
    const pts = viewFootprint(camera(new Vector3(5, 0, 5)), 0, 8);
    expect(pts).toHaveLength(8);
    expect(pts.filter((p) => Math.abs(p.y) < 1e-9)).toHaveLength(4);
    expect(pts.filter((p) => Math.abs(p.y - 8) < 1e-9)).toHaveLength(4);
    const ground = pts.filter((p) => Math.abs(p.y) < 1e-9);
    const cx = ground.reduce((s, p) => s + p.x, 0) / 4;
    const cz = ground.reduce((s, p) => s + p.z, 0) / 4;
    expect(cx).toBeCloseTo(5);
    expect(cz).toBeCloseTo(5);
  });
});

describe('fitShadowFrustum', () => {
  it('covers everything that can be on screen (both slab planes)', () => {
    for (const zoom of [0.5, 1, 3]) {
      const cam = camera(new Vector3(12, 0, -7), zoom);
      const fit = fitShadowFrustum(cam, LIGHT);
      for (const p of viewFootprint(cam, DEFAULT_SHADOW_FIT.minY, DEFAULT_SHADOW_FIT.maxY)) {
        const s = inShadowSpace(fit, p);
        expect(Math.abs(s.x)).toBeLessThanOrEqual(fit.halfSize);
        expect(Math.abs(s.y)).toBeLessThanOrEqual(fit.halfSize);
        expect(-s.z).toBeGreaterThanOrEqual(fit.near);
        expect(-s.z).toBeLessThanOrEqual(fit.far);
      }
    }
  });

  it('is much tighter than a fixed ±45 box at default zoom, and grows when zooming out', () => {
    const near = fitShadowFrustum(camera(), LIGHT);
    const far = fitShadowFrustum(camera(new Vector3(), 0.5), LIGHT);
    expect(near.halfSize).toBeLessThan(45);
    expect(far.halfSize).toBeGreaterThan(near.halfSize);
  });

  it('places the light along the given direction from the target', () => {
    const fit = fitShadowFrustum(camera(new Vector3(3, 0, 4)), LIGHT);
    const dir = fit.position.clone().sub(fit.target).normalize();
    expect(dir.distanceTo(LIGHT)).toBeLessThan(1e-9);
  });

  it('snaps to whole texels so a moving camera does not make shadows shimmer', () => {
    const a = fitShadowFrustum(camera(new Vector3(0, 0, 0)), LIGHT);
    const b = fitShadowFrustum(camera(new Vector3(0.123, 0, 0.0371)), LIGHT);
    expect(b.halfSize).toBe(a.halfSize);
    const texel = (2 * a.halfSize) / DEFAULT_SHADOW_FIT.mapSize;
    // Offset between the two targets across the light, in texels, is an integer.
    const basis = new Matrix4().lookAt(LIGHT, new Vector3(), new Vector3(0, 1, 0)).invert();
    const d = b.target.clone().sub(a.target).applyMatrix4(basis);
    expect(Math.abs(d.x / texel - Math.round(d.x / texel))).toBeLessThan(1e-6);
    expect(Math.abs(d.y / texel - Math.round(d.y / texel))).toBeLessThan(1e-6);
  });

  it('quantises the size and caps it when zoomed far out', () => {
    const fit = fitShadowFrustum(camera(new Vector3(), 0.05), LIGHT);
    expect(fit.halfSize).toBe(DEFAULT_SHADOW_FIT.maxHalfSize);
    const normal = fitShadowFrustum(camera(), LIGHT);
    expect(normal.halfSize % DEFAULT_SHADOW_FIT.sizeStep).toBe(0);
  });

  it('rejects a camera that does not look down', () => {
    const c = camera();
    c.position.copy(isometricOffset(100).setY(0));
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld();
    expect(() => fitShadowFrustum(c, LIGHT)).toThrow();
  });
});
