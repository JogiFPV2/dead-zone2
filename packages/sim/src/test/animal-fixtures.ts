import { buildContentBundle, type ContentBundle } from '@deadzone/content';
import type { SimAnimalSpawn } from '@deadzone/protocol';
import { createSim, type Sim, type SimOptions } from '../sim.js';
import { NOON } from './ai-fixtures.js';
import { fixturePack } from './content-fixtures.js';
import { buildMap, type MapSpec } from './fixtures.js';

const base = {
  sightRangeTiles: 14,
  hearingRangeTiles: 22,
  fleeDistanceTiles: 8,
  safeDistanceTiles: 16,
  fleeMinSec: 2,
  grazeSec: { min: 1, max: 3 },
  wanderRadiusTiles: 4,
};

/**
 * Fixture animals: rabbit (huntable, wild, 2 meat + 1 hide), bird (flies off after 1 s), dog
 * (town, barks when fleeing), cat (town), tortoise (barely flees: melee hunting tests).
 */
export const ANIMAL_TYPES = [
  {
    id: 'fixture:rabbit',
    name: 'animal.fixture.rabbit',
    health: 6,
    speed: { wanderTilesPerSec: 1, fleeTilesPerSec: 5 },
    radiusTiles: 0.2,
    ...base,
    huntable: true,
    habitat: 'wild',
    spawnWeight: 3,
    loot: [{ item: 'fixture:meat', count: { min: 2, max: 2 } }, { item: 'fixture:hide' }],
  },
  {
    id: 'fixture:bird',
    name: 'animal.fixture.bird',
    health: 1,
    speed: { wanderTilesPerSec: 0.5, fleeTilesPerSec: 8 },
    radiusTiles: 0.1,
    ...base,
    fliesAway: true,
    despawnAfterFleeSec: 1,
  },
  {
    id: 'fixture:dog',
    name: 'animal.fixture.dog',
    health: 20,
    speed: { wanderTilesPerSec: 1, fleeTilesPerSec: 5 },
    ...base,
    habitat: 'town',
    fleeNoise: { radiusTiles: 25, volume: 0.8 },
  },
  {
    id: 'fixture:cat',
    name: 'animal.fixture.cat',
    health: 8,
    speed: { wanderTilesPerSec: 0.8, fleeTilesPerSec: 4 },
    ...base,
    habitat: 'town',
  },
  {
    id: 'fixture:tortoise',
    name: 'animal.fixture.tortoise',
    health: 4,
    speed: { wanderTilesPerSec: 0, fleeTilesPerSec: 0 },
    ...base,
    huntable: true,
    spawnWeight: 0,
    loot: [{ item: 'fixture:meat', count: { min: 1, max: 3 } }],
  },
];

export const animalContent = (): ContentBundle => {
  const pack = fixturePack();
  return buildContentBundle([
    {
      ...pack,
      files: [
        ...pack.files,
        {
          path: 'items/game.json',
          json: [
            { id: 'fixture:meat', name: 'item.fixture.meat', kind: 'misc', weightKg: 0.3 },
            { id: 'fixture:hide', name: 'item.fixture.hide', kind: 'material', weightKg: 1 },
          ],
        },
        ...ANIMAL_TYPES.map((a) => ({ path: `animal-types/${a.id.slice(8)}.json`, json: a })),
      ],
    },
  ]);
};

let cached: ContentBundle | undefined;
const content = (): ContentBundle => (cached ??= animalContent());

/** Fixture sim with animals (player at (10.5, 10.5), noon, dev). */
export function animalSim(
  opts: { map?: MapSpec; animals?: readonly SimAnimalSpawn[]; seed?: number } & Partial<
    Omit<SimOptions, 'map'>
  > = {},
): Sim {
  const { map, animals, seed, ...rest } = opts;
  return createSim({
    seed: seed ?? 21,
    map: buildMap(map ?? {}),
    spawn: { x: 10.5, y: 10.5 },
    content: content(),
    dev: true,
    clockStart: NOON,
    ...(animals ? { spawnAnimals: animals } : {}),
    ...rest,
  });
}

export const animal = (sim: Sim, i = 0) => sim.getAnimals()[i]!;
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
