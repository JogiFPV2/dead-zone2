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

  it('rejects mismatched LOD ratios and distances', () => {
    expect(() => parsePack({ ...pack, lod: { ratios: [0.5], distances: [] } })).toThrow(/lod/);
  });
});
