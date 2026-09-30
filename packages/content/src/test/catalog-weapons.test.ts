import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '../bundle/content-bundle.js';
import { baseBundle } from './base-bundle.js';

const ofKind = (b: ContentBundle, kind: string) =>
  Object.values(b.items).filter((i) => i.kind === kind);
const has = (b: ContentBundle, ids: string[]) => ids.filter((id) => !b.items[`base:${id}`]);

describe('katalog broni', () => {
  it('ma całą broń białą z planu, każdą z hałasem, trwałością i umiejętnością', async () => {
    const b = await baseBundle();
    const required = [
      'bottle',
      'stone',
      'brick',
      'kitchen-knife',
      'hunting-knife',
      'screwdriver',
      'hammer',
      'crowbar',
      'baseball-bat',
      'nailed-bat',
      'golf-club',
      'metal-pipe',
      'machete',
      'hatchet',
      'axe',
      'fire-axe',
      'sledgehammer',
      'shovel',
      'spear',
      'knife-spear',
      'frying-pan',
    ];
    expect(has(b, required)).toEqual([]);
    const melee = ofKind(b, 'weapon_melee');
    expect(melee.length).toBeGreaterThanOrEqual(25);
    for (const w of melee) {
      if (w.kind !== 'weapon_melee') continue;
      expect(w.melee.hitNoise, w.id).toBeDefined();
      expect(w.melee.damage.max, w.id).toBeGreaterThan(w.melee.damage.min);
      expect(w.weightKg, w.id).toBeGreaterThan(0);
    }
  });

  it('butelka się tłucze, rzuca i hałasuje; kamień i cegła są rzucane', async () => {
    const b = await baseBundle();
    const bottle = b.items['base:bottle'];
    expect(bottle?.throwable).toMatchObject({ breaksOnImpact: true });
    expect(bottle?.throwable?.impactNoise.radiusTiles).toBeGreaterThan(10);
    expect(bottle?.kind === 'weapon_melee' && bottle.melee.durability.brokenInto).toBe(
      'base:broken-bottle',
    );
    expect(b.items['base:stone']?.throwable?.breaksOnImpact).toBe(false);
    expect(b.items['base:brick']?.throwable).toBeDefined();
  });

  it('ma broń palną z planu z amunicją, magazynkami i pudełkami', async () => {
    const b = await baseBundle();
    const guns = ofKind(b, 'weapon_ranged').flatMap((g) => (g.kind === 'weapon_ranged' ? [g] : []));
    const count = (c: string) => guns.filter((g) => g.ranged.category === c).length;
    expect(count('pistol')).toBeGreaterThanOrEqual(2);
    expect(count('revolver')).toBe(2);
    expect(count('shotgun')).toBe(2);
    expect(count('rifle')).toBe(2);
    expect(
      has(b, ['pump-shotgun', 'double-barrel-shotgun', 'hunting-rifle', 'assault-rifle']),
    ).toEqual([]);
    const boxed = new Set(
      ofKind(b, 'ammo_box').map((x) => x.kind === 'ammo_box' && x.ammoBox.ammo),
    );
    for (const g of guns) {
      expect(boxed.has(g.ranged.ammo), `${g.id}: pudełko ${g.ranged.ammo}`).toBe(true);
      expect(g.ranged.shotNoise.radiusTiles, g.id).toBeGreaterThan(30);
    }
    expect(guns.some((g) => g.ranged.feed.type === 'magazine')).toBe(true);
  });
});
