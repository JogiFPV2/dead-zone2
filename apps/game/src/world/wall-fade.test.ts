import { describe, expect, it } from 'vitest';
import type { WebGLProgramParametersWithUniforms } from 'three';
import {
  edgeFade,
  FADE_EDGE,
  FADE_EDGE_FROM,
  FADE_MIN,
  FADE_MS,
  occludesPlayer,
  patchFadeShader,
  stepFade,
  type FadeView,
} from './wall-fade.js';
import { WALL_HEIGHT } from './structure-instances.js';

// Camera toward +y (yaw 0: offset (sin 0, cos 0) = (0, 1)).
const v: FadeView = { px: 10, py: 10, yaw: 0, z: 0 };

describe('occludesPlayer', () => {
  it('a wall 1.5 m in front toward the camera fades', () => {
    expect(occludesPlayer(v, 9, 11.5, 11, 11.5)).toBe(true);
  });
  it('a wall behind the player (away from the camera) does not', () => {
    expect(occludesPlayer(v, 9, 8.5, 11, 8.5)).toBe(false);
  });
  it('a camera-side wall of the neighbouring room (off the corridor) does not', () => {
    expect(occludesPlayer(v, 12, 11.5, 14, 11.5)).toBe(false);
  });
  it('beyond 3 m it does not; hysteresis keeps a fading one up to 3.5 m', () => {
    expect(occludesPlayer(v, 9, 13.3, 11, 13.3)).toBe(false);
    expect(occludesPlayer(v, 9, 13.3, 11, 13.3, true)).toBe(true);
  });
});

describe('stepFade', () => {
  it('takes FADE_MS across the full range, both ways', () => {
    expect(stepFade(1, 0, FADE_MS / 2)).toBeCloseTo(0.5);
    expect(stepFade(0.15, 1, FADE_MS)).toBe(1);
  });
});

describe('top edge of a faded wall (Designer spec: outline stays ~0.5)', () => {
  it('the top band keeps FADE_EDGE, the rest fades to FADE_MIN', () => {
    expect(FADE_EDGE).toBe(0.5);
    expect(edgeFade(FADE_MIN, 1)).toBe(FADE_MIN);
    expect(edgeFade(FADE_MIN, WALL_HEIGHT - 0.1)).toBe(FADE_EDGE);
    expect(edgeFade(FADE_MIN, FADE_EDGE_FROM - 0.01)).toBe(FADE_MIN);
  });
  it('unfaded walls and walls already above FADE_EDGE are unchanged', () => {
    expect(edgeFade(1, WALL_HEIGHT)).toBe(1);
    expect(edgeFade(0.8, WALL_HEIGHT)).toBe(0.8);
  });
  it('the shader reads the height above the instance origin and applies the band', () => {
    const sh = {
      vertexShader: '#include <color_vertex>\n#include <begin_vertex>\n',
      fragmentShader: '#include <clipping_planes_fragment>\n',
    } as WebGLProgramParametersWithUniforms;
    patchFadeShader(sh, false);
    expect(sh.vertexShader).toContain('batchingMatrix[3].y');
    expect(sh.vertexShader).toContain('instanceMatrix[3].y');
    expect(sh.fragmentShader).toContain(`vDzH >= ${FADE_EDGE_FROM.toFixed(3)}`);
    expect(sh.fragmentShader).toContain('max( vDzFade, 0.500 )');
  });
});
