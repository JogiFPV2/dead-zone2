import { MeshStandardMaterial, ShaderChunk, ShaderLib, UniformsUtils } from 'three';
import { describe, expect, it } from 'vitest';
import {
  STYLE_UNIFORM,
  applyStyleMaterials,
  installStyleShaders,
  registerCharacterMaterial,
} from './style-materials.js';

describe('style materials', () => {
  it('installs the ramp once and shares its uniform through the ShaderLib clone', () => {
    installStyleShaders();
    installStyleShaders();
    expect(ShaderChunk.lights_pars_begin.match(/uniform DzStyle dzStyle/g)).toHaveLength(1);
    expect(ShaderChunk.lights_fragment_end).toContain('dzStyle.toon');
    const cloned = UniformsUtils.clone(ShaderLib.physical.uniforms) as Record<
      string,
      { value: unknown }
    >;
    expect(cloned.dzStyle!.value).toBe(STYLE_UNIFORM.value);
  });

  it('switches the ramp and lifts character materials without recompiling', () => {
    const m = new MeshStandardMaterial();
    m.emissiveIntensity = 0.22;
    registerCharacterMaterial(m);
    const version = m.version;
    applyStyleMaterials({ toon: true, hulls: true, lift: 0.35 });
    expect(STYLE_UNIFORM.value.toon).toBe(1);
    expect(m.emissiveIntensity).toBeCloseTo(0.57);
    applyStyleMaterials({ toon: false, hulls: false, lift: 0 });
    expect(STYLE_UNIFORM.value.toon).toBe(0);
    expect(m.emissiveIntensity).toBeCloseTo(0.22);
    expect(m.version).toBe(version);
  });
});
