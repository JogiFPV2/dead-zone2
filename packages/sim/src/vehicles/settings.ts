import type { ContentBundle } from '@deadzone/content';
import type { SimWorld } from '../core/world.js';

/** `worldSettings.vehicles` (vehicle gameplay: enter / exit, keys, containers, horn, hotwire). */
export type VehicleGameplay = ContentBundle['worldSettings']['vehicles'];

/** Schema defaults (`VehiclesSettingsSchema.parse({})`; a test keeps them equal). */
export const DEFAULT_VEHICLE_GAMEPLAY: VehicleGameplay = {
  enterSec: 1.5,
  exitSec: 1,
  keyItem: 'base:car-key',
  trunkContainer: 'base:car-trunk',
  gloveboxContainer: 'base:car-glovebox',
  trunkReachTiles: 1.5,
  horn: { noise: { radiusTiles: 45, volume: 1 }, cooldownSec: 0.5 },
  hotwire: {
    sec: 6,
    electricalSkill: 'base:electrical',
    mechanicsSkill: 'base:mechanics',
    minElectrical: 1,
    minMechanics: 0,
    baseChance: 0.2,
    chancePerElectrical: 0.1,
    chancePerMechanics: 0.05,
    maxChance: 0.95,
    noise: { radiusTiles: 6, volume: 0.35 },
    xp: 4,
  },
  fuel: {
    canItem: 'base:gas-can',
    canCapacityL: 10,
    hoseTag: 'base:tool-hose',
    pumpItem: 'base:fuel-pump',
    refuelLps: 1,
    siphonLps: 0.25,
    pumpPoweredLps: 1.5,
    pumpManualLps: 0.3,
    pumpReserveL: { min: 200, max: 1000 },
    reachTiles: 1.5,
    pumpHoseTiles: 4,
    tankLeakLps: 0.02,
  },
  repair: {
    skill: 'base:mechanics',
    reachTiles: 1.5,
    engine: {
      sec: 20,
      tools: ['base:tool-wrench'],
      parts: [{ item: 'base:engine-parts', count: 1 }],
      minSkill: 2,
      hpBase: 20,
      hpPerLevel: 8,
      xp: 10,
    },
    tire: {
      sec: 10,
      tools: ['base:tool-wrench'],
      parts: [{ item: 'base:car-tire', count: 1 }],
      minSkill: 0,
      hpBase: 100,
      hpPerLevel: 0,
      xp: 4,
    },
    window: {
      sec: 12,
      tools: [],
      parts: [{ item: 'base:car-window', count: 1 }],
      minSkill: 1,
      hpBase: 100,
      hpPerLevel: 0,
      xp: 4,
    },
    body: {
      sec: 15,
      tools: ['base:tool-hammer'],
      parts: [{ item: 'base:scrap-metal', count: 2 }],
      minSkill: 1,
      hpBase: 15,
      hpPerLevel: 6,
      xp: 6,
    },
    battery: {
      sec: 8,
      tools: [],
      parts: [{ item: 'base:car-battery', count: 1 }],
      minSkill: 0,
      hpBase: 100,
      hpPerLevel: 0,
      xp: 3,
    },
    fuelTank: {
      sec: 18,
      tools: ['base:tool-wrench'],
      parts: [{ item: 'base:fuel-tank', count: 1 }],
      minSkill: 1,
      hpBase: 100,
      hpPerLevel: 0,
      xp: 6,
    },
  },
  spawn: {
    defaultType: 'base:sedan',
    lockedChance: 0.6,
    key: { ignition: 10, glovebox: 15, building: 20, zombie: 15, none: 40 },
    fuel: { min: 0, max: 0.6 },
    keyZombieTiles: 40,
  },
};

/** Vehicle gameplay settings of the world's content (defaults without content). */
export const vehicleSettings = (w: SimWorld): VehicleGameplay =>
  w.survival?.content.vehicles ?? w.items?.content.vehicles ?? DEFAULT_VEHICLE_GAMEPLAY;
