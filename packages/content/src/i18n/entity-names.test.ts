import { describe, expect, it } from 'vitest';
import { buildContentBundle } from '../bundle/index.js';
import { BASE_PACK_DIR, readPackDir } from '../node/index.js';
import { ENTITY_NAMES_PL, entityNamePl } from './entity-names.js';

describe('ENTITY_NAMES_PL', () => {
  it('names every zombie, animal and vehicle type of the base pack (and nothing else)', async () => {
    const b = buildContentBundle([await readPackDir(BASE_PACK_DIR)]);
    expect(Object.keys(ENTITY_NAMES_PL.zombie).sort()).toEqual(Object.keys(b.zombieTypes).sort());
    expect(Object.keys(ENTITY_NAMES_PL.animal).sort()).toEqual(Object.keys(b.animalTypes).sort());
    expect(Object.keys(ENTITY_NAMES_PL.vehicle).sort()).toEqual(Object.keys(b.vehicleTypes).sort());
  });

  it('falls back to the id without the namespace', () => {
    expect(entityNamePl('animal', 'base:deer')).toBe('Sarna');
    expect(entityNamePl('zombie', 'mod:fast-runner')).toBe('fast runner');
  });
});
