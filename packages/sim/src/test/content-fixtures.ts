import { buildContentBundle, type ContentBundle, type PackSource } from '@deadzone/content';
import { BASE_PACK_DIR, readPackDir } from '@deadzone/content/node';
import type { Command, SimContentPack } from '@deadzone/protocol';
import { createSim, type Sim, type SimOptions } from '../sim.js';
import { buildMap } from './fixtures.js';

const level = (enterAt: number, exitAt: number, modifiers: unknown[] = []) => ({
  label: 'moodle.fixture.level',
  enterAt,
  exitAt,
  modifiers,
});

/**
 * Small fixture pack (docs 8.2: tests do not depend on the real game balance): default
 * `worldSettings` from the schemas plus a few moodles and a bandage.
 */
export function fixturePack(worldSettings: object = {}): SimContentPack {
  return {
    dir: 'fixture',
    files: [
      { path: 'mod.json', json: { id: 'fixture', name: 'Fixture', version: '0.0.0' } },
      { path: 'world-settings.json', json: worldSettings },
      {
        path: 'moodles/hunger.json',
        json: {
          id: 'fixture:hunger',
          name: 'moodle.fixture.hunger',
          polarity: 'negative',
          maxLevel: 2,
          stat: 'hunger',
          levels: [level(25, 20), level(50, 45)],
        },
      },
      {
        path: 'moodles/fatigue.json',
        json: {
          id: 'fixture:fatigue',
          name: 'moodle.fixture.fatigue',
          polarity: 'negative',
          maxLevel: 2,
          stat: 'fatigue',
          levels: [level(45, 40), level(80, 75, [{ stat: 'move-speed', op: 'mul', value: 0.5 }])],
        },
      },
      {
        path: 'moodles/bleeding.json',
        json: {
          id: 'fixture:bleeding',
          name: 'moodle.fixture.bleeding',
          polarity: 'negative',
          maxLevel: 1,
          stat: 'bleeding',
          levels: [level(5, 2)],
        },
      },
      {
        path: 'moodles/cold.json',
        json: {
          id: 'fixture:cold',
          name: 'moodle.fixture.cold',
          polarity: 'negative',
          maxLevel: 2,
          stat: 'body-temperature-c',
          direction: 'falling',
          levels: [level(36, 36.3), level(35, 35.3)],
        },
      },
      {
        path: 'moodles/carry.json',
        json: {
          id: 'fixture:carry',
          name: 'moodle.fixture.carry',
          polarity: 'negative',
          maxLevel: 1,
          stat: 'carry-load',
          levels: [level(100, 97, [{ stat: 'move-speed', op: 'mul', value: 0.5 }])],
        },
      },
      {
        path: 'items/stage3.json',
        json: [
          {
            id: 'fixture:beans',
            name: 'item.fixture.beans',
            kind: 'food',
            weightKg: 0.4,
            food: {
              nutrition: { calories: 400, hunger: -40, unhappiness: 2 },
              spoilage: { freshMin: 1000, rottenMin: 2000 },
              portions: 2,
              openWith: 'fixture:can-opener',
              emptyInto: 'fixture:can',
            },
          },
          {
            id: 'fixture:apple',
            name: 'item.fixture.apple',
            kind: 'food',
            weightKg: 0.2,
            food: {
              nutrition: { calories: 80, hunger: -10 },
              spoilage: { freshMin: 100, rottenMin: 200 },
            },
          },
          {
            id: 'fixture:water',
            name: 'item.fixture.water',
            kind: 'drink',
            weightKg: 0.5,
            drink: { perUse: { thirst: -20 }, uses: 2, emptyInto: 'fixture:bottle' },
          },
          { id: 'fixture:bottle', name: 'item.fixture.bottle', kind: 'misc', weightKg: 0.1 },
          { id: 'fixture:can', name: 'item.fixture.can', kind: 'misc', weightKg: 0.05 },
          {
            id: 'fixture:opener',
            name: 'item.fixture.opener',
            kind: 'tool',
            weightKg: 0.1,
            tags: ['fixture:can-opener'],
            tool: {},
          },
          {
            id: 'fixture:brick',
            name: 'item.fixture.brick',
            kind: 'material',
            weightKg: 2,
            maxStack: 10,
          },
          {
            id: 'fixture:ammo-9',
            name: 'item.fixture.ammo-9',
            kind: 'ammo',
            weightKg: 0.01,
            maxStack: 50,
            tags: ['fixture:ammo'],
            ammo: { caliber: '9mm' },
          },
          {
            id: 'fixture:ammo-box',
            name: 'item.fixture.ammo-box',
            kind: 'ammo_box',
            weightKg: 0.4,
            maxStack: 5,
            ammoBox: { ammo: 'fixture:ammo-9', count: 30 },
          },
          {
            id: 'fixture:backpack',
            name: 'item.fixture.backpack',
            kind: 'container',
            weightKg: 1,
            bag: { capacityKg: 10, weightReductionPct: 50, slots: ['back'], movementPenalty: 0.2 },
          },
          {
            id: 'fixture:plastic-bag',
            name: 'item.fixture.plastic-bag',
            kind: 'container',
            weightKg: 0.02,
            bag: {
              capacityKg: 3,
              weightReductionPct: 0,
              slots: ['hand_primary', 'hand_secondary'],
            },
          },
          {
            id: 'fixture:ammo-pouch',
            name: 'item.fixture.ammo-pouch',
            kind: 'container',
            weightKg: 0.1,
            bag: {
              capacityKg: 2,
              weightReductionPct: 20,
              slots: ['belt'],
              acceptsTags: ['fixture:ammo'],
            },
          },
          {
            id: 'fixture:crate-item',
            name: 'item.fixture.crate-item',
            kind: 'placeable',
            weightKg: 4,
            placeable: { containerType: 'fixture:crate' },
          },
          {
            id: 'fixture:bed',
            name: 'item.fixture.bed',
            kind: 'placeable',
            weightKg: 40,
            placeable: { sleepSurface: 'bed' },
          },
          {
            id: 'fixture:sofa',
            name: 'item.fixture.sofa',
            kind: 'placeable',
            weightKg: 30,
            placeable: { sleepSurface: 'sofa' },
          },
        ],
      },
      {
        path: 'zombie-types/walker.json',
        json: {
          id: 'fixture:walker',
          name: 'zombie.fixture.walker',
          health: 50,
          speed: { wanderTilesPerSec: 0.5, chaseTilesPerSec: 2 },
          damage: { min: 1, max: 2 },
          attackCooldownSec: 1,
          biteChance: 0.2,
          sightRangeTiles: 16,
          hearingRangeTiles: 30,
        },
      },
      {
        path: 'skills/fixture.json',
        json: [
          {
            id: 'fixture:blunt',
            name: 'skill.fixture.blunt',
            group: 'combat',
            xpPerLevel: [50, 110, 190, 300, 440, 610, 820, 1070, 1360, 1700],
          },
        ],
      },
      {
        path: 'items/lights.json',
        json: [
          {
            id: 'fixture:lantern',
            name: 'item.fixture.lantern',
            kind: 'placeable',
            weightKg: 1,
            placeable: { light: { radiusTiles: 6, intensity: 1, requiresPower: false } },
          },
          {
            id: 'fixture:flashlight',
            name: 'item.fixture.flashlight',
            kind: 'tool',
            weightKg: 0.3,
            tool: {},
            light: { radiusTiles: 8, intensity: 0.9, coneDeg: 50 },
          },
          {
            id: 'fixture:bat',
            name: 'item.fixture.bat',
            kind: 'weapon_melee',
            weightKg: 1,
            melee: {
              category: 'blunt',
              skill: 'fixture:blunt',
              damage: { min: 30, max: 30 },
              rangeTiles: 1.3,
              attacksPerSec: 1,
              staminaCost: 5,
              knockback: 1,
              twoHanded: true,
              hitNoise: { radiusTiles: 5, volume: 0.4 },
              durability: { max: 2, lossChancePerUse: 1 },
            },
          },
          {
            id: 'fixture:street-lamp',
            name: 'item.fixture.street-lamp',
            kind: 'placeable',
            weightKg: 20,
            placeable: { light: { radiusTiles: 5, intensity: 0.9 } },
          },
        ],
      },
      {
        path: 'containers/fixture.json',
        json: [
          {
            id: 'fixture:cabinet',
            name: 'container.fixture.cabinet',
            category: 'cabinet',
            capacityKg: 20,
            searchMin: 2,
            defaultLootTable: 'fixture:default',
          },
          {
            id: 'fixture:fridge',
            name: 'container.fixture.fridge',
            category: 'fridge',
            capacityKg: 30,
            spoilageMultiplier: 0.3,
            requiresPower: true,
          },
          {
            id: 'fixture:crate',
            name: 'container.fixture.crate',
            category: 'crate',
            capacityKg: 30,
            searchMin: 0.5,
            pickupItem: 'fixture:crate-item',
          },
        ],
      },
      {
        path: 'loot-tables/fixture.json',
        json: [
          {
            id: 'fixture:kitchen',
            rooms: ['fixture:room-kitchen'],
            containers: ['fixture:cabinet'],
            rolls: { min: 3, max: 6 },
            entries: [
              { item: 'fixture:beans', weight: 5, count: { min: 1, max: 2 } },
              { item: 'fixture:water', weight: 3 },
              { item: 'fixture:opener', weight: 1, rarity: 'rare' },
              { table: 'fixture:ammo', weight: 2, rarity: 'uncommon' },
            ],
          },
          {
            id: 'fixture:ammo',
            rolls: { min: 1, max: 1 },
            entries: [{ item: 'fixture:ammo-box', weight: 1, count: { min: 1, max: 2 } }],
          },
          {
            id: 'fixture:default',
            rolls: { min: 1, max: 2 },
            entries: [{ item: 'fixture:brick', weight: 1, count: { min: 1, max: 12 } }],
          },
        ],
      },
      {
        path: 'items/medical.json',
        json: [
          {
            id: 'fixture:bandage',
            name: 'item.fixture.bandage',
            kind: 'medical',
            weightKg: 0.05,
            medical: { effects: ['stop_bleeding'], durationMin: 3 },
          },
          {
            id: 'fixture:quick-bandage',
            name: 'item.fixture.quick-bandage',
            kind: 'medical',
            weightKg: 0.05,
            maxStack: 10,
            medical: { effects: ['stop_bleeding'], durationMin: 0.01 },
          },
          {
            id: 'fixture:pills',
            name: 'item.fixture.pills',
            kind: 'medical',
            weightKg: 0.05,
            medical: { effects: ['pain_relief'], durationMin: 1 },
          },
        ],
      },
    ],
  };
}

export const fixtureContent = (worldSettings: object = {}): ContentBundle =>
  buildContentBundle([
    { ...fixturePack(worldSettings), files: [...fixturePack(worldSettings).files] },
  ]);

let base: Promise<ContentBundle> | undefined;
/** The real base pack (only for the Stage 2 acceptance tests). */
export function baseContent(): Promise<ContentBundle> {
  base ??= readPackDir(BASE_PACK_DIR).then((p: PackSource) => buildContentBundle([p]));
  return base;
}

/** 60-minute day → 50 ticks per game minute. */
export const TICKS_PER_MIN = 50;

export function survivalSim(
  content: ContentBundle = fixtureContent(),
  opts: Partial<SimOptions> = {},
): Sim {
  return createSim({
    seed: 7,
    map: buildMap(),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    ...opts,
  });
}

let seq = 1_000_000;
type Payload = Command extends infer C
  ? C extends Command
    ? Omit<C, 'tick' | 'playerId' | 'seq'>
    : never
  : never;

/** Enqueues a command for the current tick (throws when the queue rejects it structurally). */
export function send(sim: Sim, payload: Payload, playerId = 0): void {
  const r = sim.enqueue({ ...payload, tick: sim.tick, playerId, seq: seq++ });
  if (!r.ok) throw new Error(`rejected: ${r.reason} ${r.error ?? ''}`);
}

export const runMinutes = (sim: Sim, minutes: number): void => {
  for (let i = 0; i < minutes * TICKS_PER_MIN; i++) sim.step();
};
