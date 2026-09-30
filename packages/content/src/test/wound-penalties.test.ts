import { describe, expect, it } from 'vitest';
import type { ToolItem } from '../schemas/item/tool.js';
import { WorldSettingsSchema } from '../schemas/world-settings.js';
import { baseBundle } from './base-bundle.js';

describe('kary z ran, widzenie i czasy akcji', () => {
  it('rany: noga −15% lekka, −35% ciężka; opatrunek połowa; limit −60%', async () => {
    const p = (await baseBundle()).worldSettings.survival.woundPenalties;
    expect(p.light.leg.moveSpeed).toBe(0.15);
    expect(p.heavy.leg.moveSpeed).toBe(0.35);
    expect(p.heavy.arm.attackPower).toBeGreaterThan(p.light.arm.attackPower);
    expect(p.bandagedFactor).toBe(0.5);
    expect(p.maxPenalty).toBe(0.6);
    expect(p.severity).toEqual({
      scratch: 'light',
      laceration: 'light',
      bite: 'heavy',
      deep: 'heavy',
    });
    for (const c of ['pain', 'fever', 'bleeding'] as const)
      expect(p.conditions[c].visionRange, c).toBeGreaterThan(0);
  });

  it('każda z 17 części ciała ma grupę, domyślnie bez pliku', () => {
    const s = WorldSettingsSchema.parse({});
    const g = s.survival.woundPenalties.bodyGroups;
    expect(Object.keys(g)).toHaveLength(17);
    expect([g.head, g.neck, g.groin, g.hand_l, g.foot_r]).toEqual([
      'head',
      'head',
      'torso',
      'arm',
      'leg',
    ]);
    expect(s.vision).toEqual({
      enabled: true,
      dayRangeTiles: 30,
      nightFactor: 0.4,
      lightBonus: 0.5,
    });
  });

  it('udźwig nie ma już spowolnienia za kg (liczy je moodle), jest mnożnik zmęczenia', () => {
    expect(WorldSettingsSchema.safeParse({ carry: { overloadSlowdownPerKg: 0.03 } }).success).toBe(
      false,
    );
    expect(WorldSettingsSchema.parse({}).carry.overloadFatigueMul).toBe(1.5);
  });

  it('latarka i lampa świecą z baterii; czasy jedzenia, picia i rozpakowania', async () => {
    const b = await baseBundle();
    const flash = b.items['base:flashlight'] as ToolItem;
    expect(flash.light).toMatchObject({ radiusTiles: 10, coneDeg: 50, batteryTag: 'base:battery' });
    expect((b.items['base:camping-lantern'] as ToolItem).light?.coneDeg).toBe(360);
    for (const i of Object.values(b.items)) {
      if (i.kind === 'food') expect(i.food.eatMin, i.id).toBeGreaterThan(0);
      if (i.kind === 'drink') expect(i.drink.drinkMin, i.id).toBeGreaterThan(0);
      if (i.kind === 'ammo_box') expect(i.ammoBox.unpackMin, i.id).toBe(0.5);
    }
    expect(b.worldSettings.vision.nightFactor).toBe(0.4);
  });
});
