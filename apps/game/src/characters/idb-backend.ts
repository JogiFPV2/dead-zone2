import type { CharacterBackend, CharacterRecord, PutSaveResult, SaveRecord } from './schema.js';

/** Own database (the old single-slot `deadzone` DB is only read for migration). */
export const CHARACTERS_DB = 'deadzone-characters';
const DB_VERSION = 1;
const CHARS = 'characters';
const SAVES = 'saves';

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB error'));
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

export function openCharactersDb(idb: IDBFactory): Promise<IDBDatabase> {
  const open = idb.open(CHARACTERS_DB, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(CHARS)) db.createObjectStore(CHARS, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(SAVES)) {
      db.createObjectStore(SAVES, { keyPath: 'characterId' });
    }
  };
  return req(open);
}

/**
 * IndexedDB backend: `characters` and `saves` stores keyed like the cloud tables. Conditional
 * writes check the version and the character's status inside one readwrite transaction over both
 * stores, so two tabs cannot interleave between the check and the write.
 */
export function createIdbBackend(db: IDBDatabase): CharacterBackend {
  const read = async <T>(store: string, key: string): Promise<T | undefined> => {
    const tx = db.transaction(store, 'readonly');
    return (await req(tx.objectStore(store).get(key))) as T | undefined;
  };

  /** Runs `write` only when the character is alive and its save is at `expected`. */
  const conditional = (
    id: string,
    expected: number,
    write: (chars: IDBObjectStore, saves: IDBObjectStore, c: CharacterRecord) => number,
  ): Promise<PutSaveResult> => {
    const tx = db.transaction([CHARS, SAVES], 'readwrite');
    const chars = tx.objectStore(CHARS);
    const saves = tx.objectStore(SAVES);
    let result: PutSaveResult = { ok: false, currentVersion: 0 };
    const getC = chars.get(id);
    getC.onsuccess = () => {
      const c = getC.result as CharacterRecord | undefined;
      const getS = saves.get(id);
      getS.onsuccess = () => {
        const current = (getS.result as SaveRecord | undefined)?.version ?? 0;
        if (!c || c.status !== 'alive' || current !== expected) {
          result = { ok: false, currentVersion: current };
          return;
        }
        result = { ok: true, version: write(chars, saves, c) };
      };
    };
    return done(tx).then(() => result);
  };

  return {
    async listCharacters() {
      const tx = db.transaction(CHARS, 'readonly');
      return (await req(tx.objectStore(CHARS).getAll())) as CharacterRecord[];
    },
    getCharacter: (id) => read<CharacterRecord>(CHARS, id),
    async putCharacter(c) {
      const tx = db.transaction(CHARS, 'readwrite');
      tx.objectStore(CHARS).put(c);
      await done(tx);
    },
    async deleteCharacter(id) {
      const tx = db.transaction([CHARS, SAVES], 'readwrite');
      tx.objectStore(SAVES).delete(id);
      tx.objectStore(CHARS).delete(id);
      await done(tx);
    },
    getSave: (id) => read<SaveRecord>(SAVES, id),
    async getSaveVersion(id) {
      return (await read<SaveRecord>(SAVES, id))?.version ?? 0;
    },
    putSaveIfVersion: (save, expected, patch) =>
      conditional(save.characterId, expected, (chars, saves, c) => {
        saves.put(save);
        if (patch) chars.put({ ...c, ...patch });
        return save.version;
      }),
    buryIfVersion: (dead, expected) =>
      conditional(dead.id, expected, (chars, saves) => {
        saves.delete(dead.id);
        chars.put(dead);
        return expected;
      }),
  };
}
