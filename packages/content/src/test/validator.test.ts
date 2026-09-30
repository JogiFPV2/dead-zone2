import { describe, expect, it } from 'vitest';
import { validatePacks } from '../validate/validate-packs.js';
import { knife, material, memPack, miniBase } from './helpers.js';

const codes = (r: ReturnType<typeof validatePacks>) => r.errors.map((e) => e.code);

describe('validatePacks', () => {
  it('poprawna mini-paczka przechodzi bez błędów', () => {
    const r = validatePacks([miniBase()]);
    expect(r.errors).toEqual([]);
    expect(r.content.has('item', 'base:knife')).toBe(true);
  });

  it('błąd schematu wskazuje plik i ścieżkę JSON', () => {
    const r = validatePacks([
      miniBase({
        'items/bad.json': [material('base:ok'), { ...knife, id: 'base:x', weightKg: -1 }],
      }),
    ]);
    expect(r.errors).toEqual([
      expect.objectContaining({ code: 'schema', file: 'items/bad.json', path: '$[1].weightKg' }),
    ]);
  });

  it('niepoprawny JSON i nieznany katalog', () => {
    const pack = miniBase();
    pack.files.push(
      { path: 'items/broken.json', text: '{ nope' },
      { path: 'weapons/x.json', json: {} },
    );
    const r = validatePacks([pack]);
    expect(codes(r).sort()).toEqual(['json_parse', 'unknown_folder']);
  });

  it('wykrywa duplikaty id w paczce i między paczkami', () => {
    const r = validatePacks([
      miniBase({ 'items/dup.json': material('base:plank') }),
      memPack('base', {}),
    ]);
    // Kolejność wczytywania (i jej błędy) ustala się przed dodaniem definicji.
    expect(codes(r)).toEqual(['dependency', 'duplicate_id']);
    // Pliki czytane alfabetycznie: items/dup.json przed items/materials.json.
    expect(r.errors[1]).toMatchObject({ file: 'items/materials.json', path: '$[0].id' });
  });

  it('ten sam id w różnych typach jest dozwolony (przedmiot i schowek)', () => {
    const r = validatePacks([
      miniBase({
        'items/crate.json': {
          id: 'base:crate',
          kind: 'placeable',
          name: 'item.base.crate.name',
          weightKg: 5,
          placeable: { containerType: 'base:crate' },
        },
        'containers/crate.json': {
          id: 'base:crate',
          name: 'container.base.crate.name',
          category: 'crate',
          capacityKg: 30,
          pickupItem: 'base:crate',
        },
      }),
    ]);
    expect(r.errors).toEqual([]);
  });

  it('mod nie może definiować id w cudzym namespace', () => {
    const r = validatePacks([
      miniBase(),
      memPack('my-mod', { 'items/x.json': material('base:sneaky') }),
    ]);
    expect(codes(r)).toEqual(['namespace']);
  });

  it('sprawdza rodzaj przedmiotu (amunicja broni musi być ammo)', () => {
    const gun = {
      id: 'base:gun',
      kind: 'weapon_ranged',
      name: 'item.base.gun.name',
      weightKg: 1,
      ranged: {
        category: 'rifle',
        skill: 'base:blade-short',
        ammo: 'base:plank',
        feed: { type: 'internal', capacity: 5 },
        damage: { min: 1, max: 2 },
        rangeTiles: 30,
        accuracy: 0.6,
        shotsPerSec: 1,
        reloadSec: 3,
        shotNoise: { radiusTiles: 60 },
        durability: { max: 100 },
      },
    };
    const r = validatePacks([miniBase({ 'items/gun.json': gun })]);
    expect(r.errors).toEqual([
      expect.objectContaining({ code: 'wrong_kind', path: '$.ranged.ammo' }),
    ]);
  });
});
