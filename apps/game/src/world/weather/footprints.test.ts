import { Group, ShaderChunk, ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';
import { Footprints, FOOTPRINTS } from './footprints.js';
import { installSnowCover, setSnowCover, SNOW_VALUE, snowCoverNow } from './snow-cover.js';

describe('footprints in the snow', () => {
  it('one print per stride, alternating feet; none without snow, none on upper floors', () => {
    const f = new Footprints(new Group());
    f.step('p', 0, 0, 0, 1, 0);
    f.step('p', 3, 0, 0, 1, 1);
    expect(f.mesh.count).toBe(Math.floor(3 / FOOTPRINTS.stride));
    f.step('q', 0, 10, 0, 0.1, 0);
    f.step('q', 3, 10, 0, 0.1, 1);
    expect(f.mesh.count).toBe(4);
    f.step('r', 0, 20, 1, 1, 0);
    f.step('r', 3, 20, 1, 1, 1);
    expect(f.mesh.count).toBe(4);
  });

  it('prints fade with age (faster while snowing) and vanish without snow', () => {
    const f = new Footprints(new Group());
    f.step('p', 0, 0, 0, 1, 0);
    f.step('p', 1, 0, 0, 1, 0);
    const fade = () => (f.mesh.geometry.getAttribute('dzFade').array as Float32Array)[0]!;
    f.update(1, 1, 0);
    const fresh = fade();
    expect(fresh).toBeGreaterThan(0.5);
    f.update(FOOTPRINTS.lifeSnowingSec / 2, 1, 1);
    expect(fade()).toBeLessThan(fresh * 0.6);
    f.update(1, 0, 0);
    expect(f.mesh.visible).toBe(false);
  });
});

describe('snow cover on up-facing surfaces', () => {
  it('patches the lit shader chunks once and shares one uniform value', () => {
    installSnowCover();
    installSnowCover();
    expect(ShaderChunk.lights_physical_fragment).toContain('dzSnow');
    expect(ShaderChunk.lights_pars_begin.match(/uniform vec2 dzSnow/g)).toHaveLength(1);
    expect(ShaderLib.standard.uniforms.dzSnow!.value).toBe(SNOW_VALUE);
    setSnowCover(1, 100);
    expect(snowCoverNow()).toBe(1);
    setSnowCover(0, 1);
    expect(snowCoverNow()).toBeGreaterThan(0.5);
  });
});
