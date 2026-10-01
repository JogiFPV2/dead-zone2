import type { CharacterBackend, CharacterRecord, PutSaveResult, SaveRecord } from './schema.js';

/**
 * In-memory backend (tests; fallback when IndexedDB is unavailable). Several stores may share
 * one backend to play „two tabs”.
 */
export function createMemoryBackend(): CharacterBackend {
  const chars = new Map<string, CharacterRecord>();
  const saves = new Map<string, SaveRecord>();
  const version = (id: string): number => saves.get(id)?.version ?? 0;
  const conflict = (id: string, expected: number): PutSaveResult | undefined => {
    const c = chars.get(id);
    if (!c || c.status !== 'alive' || version(id) !== expected) {
      return { ok: false, currentVersion: version(id) };
    }
    return undefined;
  };
  return {
    listCharacters: () => Promise.resolve([...chars.values()]),
    getCharacter: (id) => Promise.resolve(chars.get(id)),
    putCharacter(c) {
      chars.set(c.id, c);
      return Promise.resolve();
    },
    deleteCharacter(id) {
      chars.delete(id);
      saves.delete(id);
      return Promise.resolve();
    },
    getSave: (id) => Promise.resolve(saves.get(id)),
    getSaveVersion: (id) => Promise.resolve(version(id)),
    putSaveIfVersion(save, expected, patch) {
      const bad = conflict(save.characterId, expected);
      if (bad) return Promise.resolve(bad);
      saves.set(save.characterId, save);
      const c = chars.get(save.characterId);
      if (c && patch) chars.set(c.id, { ...c, ...patch });
      return Promise.resolve({ ok: true, version: save.version });
    },
    buryIfVersion(dead, expected) {
      const bad = conflict(dead.id, expected);
      if (bad) return Promise.resolve(bad);
      saves.delete(dead.id);
      chars.set(dead.id, dead);
      return Promise.resolve({ ok: true, version: expected });
    },
  };
}
