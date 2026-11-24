import { describe, expect, it } from 'vitest';
import { Mesh, MeshStandardMaterial, BoxGeometry, Group, ShaderLib } from 'three';
import {
  paintFurnitureModel,
  patchPaintedFurniture,
  withPaintedFurniture,
} from './painted-furniture.js';

describe('Malowany: meble', () => {
  it('patches the furniture shader once: world position, painted surface after the normal', () => {
    const sh = {
      uniforms: {},
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    } as unknown as Parameters<typeof patchPaintedFurniture>[0];
    patchPaintedFurniture(sh);
    patchPaintedFurniture(sh);
    expect(sh.vertexShader.match(/vPbW = /g)).toHaveLength(1);
    expect(sh.fragmentShader.match(/float pfLayer/g)).toHaveLength(1);
    expect(sh.fragmentShader.indexOf('pfLayer')).toBeGreaterThan(
      sh.fragmentShader.indexOf('normal_fragment_maps'),
    );
    expect(Object.keys(sh.uniforms)).toContain('pbOn');
  });

  it('every material of a model once, keeping its own hooks; other materials untouched', () => {
    const m = new MeshStandardMaterial();
    const g = new Group();
    g.add(new Mesh(new BoxGeometry(), m), new Mesh(new BoxGeometry(), m));
    paintFurnitureModel(g);
    const key = m.customProgramCacheKey();
    expect(key).toContain('dz-painted-furn');
    withPaintedFurniture(m);
    expect(m.customProgramCacheKey()).toBe(key);
  });
});
