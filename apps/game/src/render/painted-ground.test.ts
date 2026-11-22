import { describe, expect, it } from 'vitest';
import {
  PAINTED_GROUND,
  PAINTED_GROUND_GLSL,
  PAINTED_GROUND_LAYERS,
  setPaintedGround,
} from './painted-ground.js';
import { terrainMaterial } from '../world/town/town-terrain.js';
import { DataTexture } from 'three';

describe('painted ground', () => {
  it('is off by default and switching it without a DOM paints nothing', () => {
    expect(PAINTED_GROUND.on.value).toBe(0);
    const before = PAINTED_GROUND.trawa.value;
    setPaintedGround(true);
    expect(PAINTED_GROUND.on.value).toBe(1);
    expect(PAINTED_GROUND.trawa.value).toBe(before);
    setPaintedGround(false);
    expect(PAINTED_GROUND.on.value).toBe(0);
  });

  it('every terrain material shares the switch and the layer textures by reference', () => {
    const m = terrainMaterial(new DataTexture());
    const sh = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    };
    m.onBeforeCompile(sh as never, undefined as never);
    expect(sh.uniforms.pgOn).toBe(PAINTED_GROUND.on);
    expect(sh.uniforms.pgSzuter).toBe(PAINTED_GROUND.szuter);
    expect(sh.fragmentShader).toContain('pgSample');
    for (const l of PAINTED_GROUND_LAYERS) expect(PAINTED_GROUND[l]).toBeDefined();
    // Gravel: earth mixed with asphalt or paving in one vertex.
    expect(PAINTED_GROUND_GLSL).toContain('vMask.w > 0.01 && (vMask.x > 0.01 || vMask.z > 0.01)');
  });
});
