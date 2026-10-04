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
};

/** Vehicle gameplay settings of the world's content (defaults without content). */
export const vehicleSettings = (w: SimWorld): VehicleGameplay =>
  w.survival?.content.vehicles ?? w.items?.content.vehicles ?? DEFAULT_VEHICLE_GAMEPLAY;
