import type { PackFile } from '@deadzone/content';

/**
 * Raw base pack files (JSON as data, not validated here). Imported lazily (`import()`), so all
 * files land in one async chunk that is shared by the sim content and `?map=` loading.
 * Maps are included: the pack only validates with them (game modes reference `base:test-town`).
 */
const FILES = import.meta.glob<unknown>('../../../../packages/content/data/base/**/*.json', {
  import: 'default',
  eager: true,
});
const PREFIX = '../../../../packages/content/data/base/';

export const BASE_PACK_DIR = 'base';

export const baseFiles: PackFile[] = Object.entries(FILES)
  .map(([path, json]) => ({ path: path.slice(PREFIX.length), json }))
  .sort((a, b) => a.path.localeCompare(b.path));
