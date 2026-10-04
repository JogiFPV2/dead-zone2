import { describe, expect, it } from 'vitest';
import pack from '../packs/kenney-survival.json' with { type: 'json' };
import { parsePack } from './pack.js';

describe('parsePack', () => {
  it('accepts the committed CC0 test pack', () => {
    const p = parsePack(pack);
    expect(p.licence).toBe('CC0-1.0');
    expect(p.palette?.encoding).toBe('uastc');
  });

  it('refuses a pack without a licence entry', () => {
    const noLicence: Partial<typeof pack> = { ...pack };
    delete noLicence.licence;
    expect(() => parsePack(noLicence, 'x.json')).toThrow(/brak wpisu licencji/);
  });

  it('refuses a non-CC0 licence', () => {
    expect(() => parsePack({ ...pack, licence: 'CC-BY-4.0' })).toThrow(/nie jest dozwolona/);
  });

  it('files: a download url or a committed path, never both', () => {
    const f = { sha256: 'a'.repeat(64), name: 'x.glb' };
    const { download, sha256, ...base } = pack;
    void download;
    void sha256;
    expect(parsePack({ ...base, files: [{ ...f, path: 'animals/x.glb' }] }).files?.[0]?.path).toBe(
      'animals/x.glb',
    );
    expect(() => parsePack({ ...base, files: [f] })).toThrow(/url albo path/);
    expect(() =>
      parsePack({ ...base, files: [{ ...f, path: 'a.glb', url: 'https://x.org/a.glb' }] }),
    ).toThrow(/url albo path/);
    expect(() => parsePack({ ...base, files: [{ ...f, path: '../a.glb' }] })).toThrow();
  });

  it('rejects mismatched LOD ratios and distances', () => {
    expect(() => parsePack({ ...pack, lod: { ratios: [0.5], distances: [] } })).toThrow(/lod/);
  });
});
