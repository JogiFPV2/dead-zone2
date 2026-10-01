import { CharacterStore } from './character-store.js';
import { createIdbBackend, openCharactersDb } from './idb-backend.js';
import { legacyWorldSource } from './legacy-world.js';
import { createMemoryBackend } from './memory-backend.js';

let opened: Promise<CharacterStore> | undefined;

/**
 * The page's character store (IndexedDB; in memory when IndexedDB is unavailable, e.g. private
 * mode in some browsers). The old single save is migrated on first open.
 */
export function characterStore(): Promise<CharacterStore> {
  opened ??= (async () => {
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) return new CharacterStore(createMemoryBackend());
    try {
      const store = new CharacterStore(createIdbBackend(await openCharactersDb(idb)));
      await store.migrateLegacyWorld(legacyWorldSource(idb)).catch((e: unknown) => {
        console.warn('Postacie: migracja starego zapisu nie powiodła się', e);
      });
      return store;
    } catch (e) {
      console.warn('Postacie: IndexedDB niedostępne, zapis tylko w tej karcie', e);
      return new CharacterStore(createMemoryBackend());
    }
  })();
  return opened;
}
