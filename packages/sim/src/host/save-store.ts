/**
 * Browser save slots in IndexedDB (no UI). Structural types only (the sim has no DOM lib): pass
 * `globalThis.indexedDB` from the app. One object store `saves`, key = slot name.
 */
interface IdbRequest<T> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}
interface IdbOpenRequest extends IdbRequest<IdbDatabase> {
  onupgradeneeded: (() => void) | null;
}
interface IdbStore {
  put(value: unknown, key: string): IdbRequest<unknown>;
  get(key: string): IdbRequest<unknown>;
  delete(key: string): IdbRequest<unknown>;
  getAllKeys(): IdbRequest<unknown[]>;
}
interface IdbDatabase {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
  transaction(
    store: string,
    mode: 'readonly' | 'readwrite',
  ): { objectStore(name: string): IdbStore };
  close(): void;
}
export interface IdbFactoryLike {
  open(name: string, version?: number): IdbOpenRequest;
}

export interface StoredSave {
  slot: string;
  savedAt: number;
  tick: number;
  day: number;
  reason: string;
  buf: ArrayBuffer;
}

const DB = 'deadzone';
const STORE = 'saves';

const wrap = <T>(r: IdbRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error instanceof Error ? r.error : new Error('IndexedDB error'));
  });

export interface SaveStore {
  put(save: StoredSave): Promise<void>;
  get(slot: string): Promise<StoredSave | undefined>;
  remove(slot: string): Promise<void>;
  slots(): Promise<string[]>;
}

export function createSaveStore(idb: IdbFactoryLike): SaveStore {
  let db: Promise<IdbDatabase> | undefined;
  const open = (): Promise<IdbDatabase> => {
    db ??= new Promise((resolve, reject) => {
      const r = idb.open(DB, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error instanceof Error ? r.error : new Error('IndexedDB error'));
    });
    return db;
  };
  const store = async (mode: 'readonly' | 'readwrite') =>
    (await open()).transaction(STORE, mode).objectStore(STORE);
  return {
    async put(save) {
      await wrap((await store('readwrite')).put(save, save.slot));
    },
    async get(slot) {
      return (await wrap((await store('readonly')).get(slot))) as StoredSave | undefined;
    },
    async remove(slot) {
      await wrap((await store('readwrite')).delete(slot));
    },
    async slots() {
      return ((await wrap((await store('readonly')).getAllKeys())) as string[]).sort();
    },
  };
}
