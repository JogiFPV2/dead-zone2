import { Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { loadPbrTextures, pbrTextureFiles } from './textures.js';

describe('pbrTextureFiles', () => {
  it('asset data: lowRes on low, main set otherwise (and when lowRes is missing)', () => {
    const maps = {
      albedo: 'a/alb.ktx2',
      normal: 'a/nrm.ktx2',
      orm: 'a/orm.ktx2',
      layers: 'a/layers.json',
      lowRes: { albedo: 'a/alb5.ktx2', normal: 'a/nrm5.ktx2', orm: 'a/orm5.ktx2' },
    };
    expect(pbrTextureFiles(512, maps).albedo).toBe('a/alb5.ktx2');
    expect(pbrTextureFiles(1024, maps).orm).toBe('a/orm.ktx2');
    const noLow = { albedo: maps.albedo, normal: maps.normal, orm: maps.orm, layers: maps.layers };
    expect(pbrTextureFiles(512, noLow).normal).toBe('a/nrm.ktx2');
  });
});

describe('loadPbrTextures', () => {
  it('loads three arrays; albedo sRGB, normal / ORM linear, repeat + anisotropy', async () => {
    const urls: string[] = [];
    const t = await loadPbrTextures(
      { loadAsync: (u) => (urls.push(u), Promise.resolve(new Texture())) },
      '/',
      pbrTextureFiles(1024, {
        albedo: 'a.ktx2',
        normal: 'n.ktx2',
        orm: 'o.ktx2',
        layers: 'l.json',
      }),
      4,
    );
    expect(urls).toHaveLength(3);
    expect(t.alb.colorSpace).toBe('srgb');
    expect(t.nrm.colorSpace).toBe('');
    expect(t.orm.anisotropy).toBe(4);
  });
});
