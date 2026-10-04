import type { CharacterSummary, LastLocation, SaveConflictServer } from '@deadzone/protocol';
import type { CharacterRow, SaveRow } from '../data/types.js';

/** Row → API mapping shared by the character, export and conflict responses. */

/** Stored last location, also for tombstones (export); null before the first summarized save. */
export function storedLocation(c: CharacterRow): LastLocation | null {
  if (c.last_x === null || c.last_y === null || c.last_z === null || c.last_day === null) {
    return null;
  }
  return { place: c.last_place, x: c.last_x, y: c.last_y, z: c.last_z, day: c.last_day };
}

/** The current server save in a 409 `save_version_conflict` (null without one). */
export function conflictServer(save: SaveRow | undefined): SaveConflictServer | null {
  return save
    ? {
        version: save.version,
        gameDay: save.game_day,
        minuteOfDay: save.minute_of_day,
        updatedAt: save.updated_at,
      }
    : null;
}

/** Stored last location; tombstones and characters without a summarized save give null. */
function lastLocation(c: CharacterRow): LastLocation | null {
  return c.status === 'alive' ? storedLocation(c) : null;
}

/** `world_settings.dayLengthMinutes` when it is a sane number (sim default otherwise). */
export function dayLengthMinutes(c: CharacterRow): number | undefined {
  const v = c.world_settings.dayLengthMinutes;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10_080 ? v : undefined;
}

export function toSummary(c: CharacterRow, save: SaveRow | undefined): CharacterSummary {
  return {
    id: c.id,
    name: c.name,
    appearance: c.appearance,
    worldSeed: c.world_seed,
    worldgenVersion: c.worldgen_version,
    worldSettings: c.world_settings,
    status: c.status,
    daysSurvived: c.days_survived,
    createdAt: c.created_at,
    lastPlayedAt: c.last_played_at,
    diedAt: c.died_at,
    save:
      save && c.status === 'alive'
        ? {
            version: save.version,
            sizeBytes: save.size_bytes,
            gameDay: save.game_day,
            updatedAt: save.updated_at,
          }
        : null,
    lastLocation: lastLocation(c),
  };
}
