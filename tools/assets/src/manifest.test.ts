import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  checkManifestLicences,
  updateAssetsMd,
  type ManifestAsset,
  type ManifestPack,
} from './manifest.js';

const pack: ManifestPack = {
  id: 'p',
  name: 'Pack',
  author: 'A',
  licence: 'CC0-1.0',
  licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  source: 'https://example.com/p',
};
const asset = (id: string, p = 'p'): ManifestAsset => ({
  id: `${p}/${id}`,
  pack: p,
  sourceBytes: 10,
  lods: [{ file: `${p}/${id}.glb`, distance: 0, bytes: 5, triangles: 12 }],
});

describe('manifest', () => {
  it('sorts packs and assets deterministically', () => {
    const m = buildManifest([pack], [asset('b'), asset('a')]);
    expect(m.version).toBe(1);
    expect(m.assets.map((a) => a.id)).toEqual(['p/a', 'p/b']);
  });

  it('flags assets without a licensed pack and disallowed licences', () => {
    const m = buildManifest([{ ...pack, licence: 'GPL-3.0' }], [asset('a'), asset('x', 'q')]);
    const problems = checkManifestLicences(m, ['CC0-1.0']);
    expect(problems).toHaveLength(2);
    expect(problems.join()).toMatch(/GPL-3.0/);
    expect(problems.join()).toMatch(/q\/x/);
    expect(checkManifestLicences(buildManifest([pack], [asset('a')]), ['CC0-1.0'])).toEqual([]);
  });

  it('appends then replaces the generated ASSETS.md section, keeping the rest', () => {
    const m = buildManifest([pack], [asset('a')]);
    const first = updateAssetsMd('# Assety\n\nręczny wpis\n', m);
    expect(first).toContain('ręczny wpis');
    expect(first).toContain('| Pack | A | [CC0-1.0]');
    const second = updateAssetsMd(`${first}\nstopka\n`, buildManifest([pack], []));
    expect(second).toContain('0 modeli');
    expect(second).not.toContain('1 modeli');
    expect(second).toContain('stopka');
  });
});
