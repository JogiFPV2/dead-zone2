/**
 * Save format constants and errors (no ECS, no worker: also imported by the light
 * `@deadzone/sim/save-summary` entry). `save.ts` re-exports them.
 */
export const SAVE_FORMAT = 'deadzone-save';
/**
 * Format history (docs 9.29):
 * - 2: world header (`world`), LOD delta (`lod`), pooled eids (`freeEids`), `interest`.
 * - 3: the character's map (`playerMaps`), plus the additive fields of #106 (planks, glass) and
 *   #114 (vehicles) and #128 (vehicle parts). The format the live server starts with.
 * Versions 1 and 2 still load (missing sections = their defaults).
 */
export const SAVE_VERSION = 3;
/** Versions `loadWorld` reads (older ones are filled with defaults); the server accepts these. */
export const SAVE_READABLE_VERSIONS: readonly number[] = [1, 2, 3];

/** Why a save cannot be loaded (`SaveError.code`, worker `error.code`). */
export type SaveErrorCode =
  | 'not-a-save'
  | 'unsupported-version'
  | 'content'
  | 'capacity'
  | 'generator-version'
  | 'world-seed'
  | 'corrupt';

/** Readable load failure with a stable code (the game shows a message or offers a migration). */
export class SaveError extends Error {
  constructor(
    readonly code: SaveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}
