/** Tutorial steps already shown, kept in this browser (not in the save: a new character on the
 * same computer does not need the basics again). */
const KEY = 'dz-tutorial-done-v1';

export function loadTutorialDone(storage: Pick<Storage, 'getItem'> | undefined): string[] {
  try {
    const raw = storage?.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveTutorialDone(
  storage: Pick<Storage, 'setItem'> | undefined,
  ids: readonly string[],
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Private mode / blocked storage: hints simply come back next time.
  }
}

/** Safe `localStorage` (throws in some sandboxes). */
export function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
