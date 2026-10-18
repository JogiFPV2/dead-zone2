import { ShaderLib, type WebGLProgramParametersWithUniforms } from 'three';
import { describe, expect, it } from 'vitest';
import { patchPbrShader, type PbrVariant } from './pbr-shader.js';

const program = (): WebGLProgramParametersWithUniforms =>
  ({
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: {},
  }) as unknown as WebGLProgramParametersWithUniforms;

describe('patchPbrShader', () => {
  it.each<PbrVariant>(['model', 'kit', 'terrain'])('%s: patches every hook once', (v) => {
    const sh = program();
    patchPbrShader(sh, v);
    const f = sh.fragmentShader;
    expect(f).toContain('uniform sampler2DArray tAlb');
    expect(f).toContain('texture(tNrm, vec3(pUv, pLay))');
    // Basis normal mode: X in RGB (r), Y in A, Z reconstructed.
    expect(f).toContain('vec2(nt.r, nt.a)');
    expect(f).toContain('sqrt(max(0.0, 1.0 - dot(nxy, nxy)))');
    expect(f).toContain('roughnessFactor = clamp(pORM.g');
    expect(f).toContain('metalnessFactor = pORM.b');
    expect(f.match(/uniform sampler2DArray tAlb/g)).toHaveLength(1);
    expect(sh.vertexShader).toContain('vPW = (modelMatrix * pw).xyz');
  });

  it('model reads pbrUv / pbrL; kit a cell LUT; terrain the detail mask', () => {
    const m = program();
    patchPbrShader(m, 'model');
    expect(m.vertexShader).toContain('attribute vec2 pbrUv; attribute vec2 pbrL;');
    const k = program();
    patchPbrShader(k, 'kit');
    expect(k.fragmentShader).toContain('texture2D(tLut, vMapUv)');
    expect(k.vertexShader).not.toContain('pbrUv');
    const t = program();
    patchPbrShader(t, 'terrain');
    expect(t.vertexShader).toContain('attribute vec4 dmask');
  });

  it('throws on a shader without the hooks (three upgrade guard)', () => {
    const sh = { vertexShader: '', fragmentShader: '', uniforms: {} };
    expect(() =>
      patchPbrShader(sh as unknown as WebGLProgramParametersWithUniforms, 'model'),
    ).toThrow(/deadzone-pbr/);
  });
});
