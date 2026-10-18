import { describe, expect, it } from 'vitest';
import { validatePacks } from '../validate/validate-packs.js';
import { BASE_PACK_DIR, readPackDir } from '../node/index.js';
import { baseBundle } from './base-bundle.js';
import { memPack, miniBase } from './helpers.js';

const bottle = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'drink',
  name: `item.${id.replace(':', '.')}.name`,
  weightKg: 0.55,
  tags: [],
  drink: { perUse: { thirst: -20 }, uses: 5 },
  ...extra,
});
const tank = { capacityL: 0.5 };
const bottles = [
  bottle('base:bottle'),
  bottle('base:water-bottle', { waterContainer: tank }),
  bottle('base:dirty-water-bottle', { waterContainer: tank }),
];
const errorsOf = (r: ReturnType<typeof validatePacks>) =>
  r.errors.map((e) => [e.code, e.file, e.path]);

describe('walidator: worldSettings.water.bottles', () => {
  it('paczka bazowa przechodzi', async () => {
    expect(validatePacks([await readPackDir(BASE_PACK_DIR)]).errors).toEqual([]);
    const b = await baseBundle();
    expect(b.items[b.worldSettings.water.bottles.clean]?.waterContainer).toBeDefined();
  });

  it('poprawne butelki: brak błędów; paczka bez wody nie musi ich mieć', () => {
    expect(validatePacks([miniBase({ 'items/b.json': bottles })]).errors).toEqual([]);
    expect(validatePacks([miniBase()]).errors).toEqual([]);
  });

  it('mod wskazuje nieistniejący przedmiot i butelkę bez waterContainer', () => {
    const mod = memPack(
      'my-mod',
      {
        'items/x.json': [bottle('my-mod:jar')],
        'world-settings/water.json': {
          water: { bottles: { empty: 'my-mod:nope', clean: 'my-mod:jar' } },
        },
      },
      { dependencies: [{ id: 'base' }] },
    );
    const r = validatePacks([miniBase({ 'items/b.json': bottles }), mod]);
    expect(errorsOf(r)).toEqual([
      ['missing_ref', 'world-settings/water.json', '$.water.bottles.empty'],
      ['water_bottle_no_container', 'world-settings/water.json', '$.water.bottles.clean'],
    ]);
    expect(r.errors.every((e) => e.pack === 'mem/my-mod')).toBe(true);
  });

  it('mod usuwa waterContainer z bazy przez domyślne ustawienia: błąd też bez water.json', () => {
    const r = validatePacks([
      miniBase({
        'items/b.json': [bottles[0], bottles[1], bottle('base:dirty-water-bottle')],
      }),
    ]);
    expect(errorsOf(r)).toEqual([
      ['water_bottle_no_container', 'world-settings/water.json', '$.water.bottles.tainted'],
    ]);
  });
});
