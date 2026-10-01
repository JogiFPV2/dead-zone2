/**
 * The single world save (permadeath: one character = one save, overwritten). The sim's save blob
 * goes to IndexedDB through the sim's SaveStore (slot `world`); a tiny meta line for the pause
 * menu (day, game time) sits in localStorage.
 */
import { createSaveStore, type SaveStore, type SavedGame } from '@deadzone/sim/worker-client';
import type { WorldSaveMeta } from './pause-model.js';

export const WORLD_SLOT = 'world';
export const WORLD_META_KEY = 'deadzone.worldSave';

let store: SaveStore | undefined;
function saveStore(): SaveStore | undefined {
  if (store) return store;
  const idb = (globalThis as { indexedDB?: Parameters<typeof createSaveStore>[0] }).indexedDB;
  return idb ? (store = createSaveStore(idb)) : undefined;
}

/** Writes `save` over the world slot (and its meta line). */
export async function persistWorldSave(save: SavedGame, minuteOfDay?: number): Promise<void> {
  const s = saveStore();
  if (!s) throw new Error('IndexedDB niedostępne');
  const savedAt = Date.now();
  await s.put({
    slot: WORLD_SLOT,
    savedAt,
    tick: save.tick,
    day: save.day,
    reason: save.reason,
    buf: save.buf,
  });
  const meta: WorldSaveMeta = { day: save.day, minuteOfDay, savedAt };
  try {
    localStorage.setItem(WORLD_META_KEY, JSON.stringify(meta));
  } catch {
    // Storage disabled: the save itself is in IndexedDB.
  }
}

/** Meta of the last world save, if any. */
export function lastWorldSave(): WorldSaveMeta | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(WORLD_META_KEY) ?? 'null') as unknown;
    const m = raw as Partial<WorldSaveMeta> | null;
    return m && typeof m.day === 'number' && typeof m.savedAt === 'number'
      ? { day: m.day, minuteOfDay: m.minuteOfDay, savedAt: m.savedAt }
      : undefined;
  } catch {
    return undefined;
  }
}
