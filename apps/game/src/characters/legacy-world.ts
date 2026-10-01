/**
 * The single world save of #85 (sim SaveStore: IndexedDB `deadzone`/`saves`, slot `world`, plus
 * a meta line in localStorage `deadzone.worldSave`). Read once to migrate it into a character.
 */
import { createSaveStore } from '@deadzone/sim/worker-client';
import type { LegacyWorldSource } from './character-store.js';

export const LEGACY_SLOT = 'world';
export const LEGACY_META_KEY = 'deadzone.worldSave';
const LEGACY_DB = 'deadzone';
/** The map and seed every #85 game used (game.ts `SIM_SEED`, the prod map). */
const LEGACY_SEED = 1;
const LEGACY_MAP = 'test-town';

/** World seed from a save blob's JSON header (`{"format":…,"seed":N,…`). */
export function seedFromSave(data: ArrayBuffer): number | undefined {
  const head = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(400, data.byteLength)));
  const m = /"seed":(\d+)/.exec(head);
  return m ? Number(m[1]) : undefined;
}

function legacyMinute(): number | undefined {
  try {
    const m = JSON.parse(localStorage.getItem(LEGACY_META_KEY) ?? 'null') as {
      minuteOfDay?: unknown;
    } | null;
    return typeof m?.minuteOfDay === 'number' ? m.minuteOfDay : undefined;
  } catch {
    return undefined;
  }
}

/** True when the old database exists (avoids creating an empty one just to look). */
async function legacyDbExists(idb: IDBFactory): Promise<boolean> {
  if (typeof idb.databases !== 'function') return true;
  try {
    return (await idb.databases()).some((d) => d.name === LEGACY_DB);
  } catch {
    return true;
  }
}

export function legacyWorldSource(idb: IDBFactory): LegacyWorldSource {
  const store = createSaveStore(idb as unknown as Parameters<typeof createSaveStore>[0]);
  return {
    async read() {
      if (!(await legacyDbExists(idb))) throw new Error('no legacy save');
      const s = await store.get(LEGACY_SLOT);
      if (!s) throw new Error('no legacy save');
      return {
        data: s.buf,
        tick: s.tick,
        day: s.day,
        minuteOfDay: legacyMinute(),
        reason: s.reason,
        savedAt: s.savedAt,
        seed: seedFromSave(s.buf) ?? LEGACY_SEED,
        map: LEGACY_MAP,
      };
    },
    async clear() {
      await store.remove(LEGACY_SLOT);
      try {
        localStorage.removeItem(LEGACY_META_KEY);
      } catch {
        // Storage disabled: nothing to remove.
      }
    },
  };
}
