import { migrate, type Migrations } from './migrate.js';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, sanitizeSettings, type Settings } from './schema.js';

export const SETTINGS_STORAGE_KEY = 'deadzone.settings';

/**
 * Migrations of persisted settings (`MIGRATIONS[n]`: version n → n + 1). Version 1 is the first
 * persisted one; add a step here when SETTINGS_VERSION is bumped.
 */
export const MIGRATIONS: Migrations = {
  // 1 → 2: `interface` (zombie health overlays) added; sanitize fills its defaults.
  1: (data) => data,
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SettingsListener = (next: Settings, prev: Settings) => void;

export interface LoadResult {
  settings: Settings;
  /** Why defaults were used (corrupt JSON, newer version, …); undefined when data was read. */
  fallback?: string;
  migratedFrom?: number;
}

/** Parses persisted text; never throws. */
export function loadSettings(text: string | null, migrations: Migrations = MIGRATIONS): LoadResult {
  if (text === null) return { settings: DEFAULT_SETTINGS };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { settings: DEFAULT_SETTINGS, fallback: 'uszkodzony JSON' };
  }
  const m = migrate(raw, SETTINGS_VERSION, migrations);
  if (!m.ok) return { settings: DEFAULT_SETTINGS, fallback: m.reason };
  const settings = sanitizeSettings(m.data);
  return m.from === SETTINGS_VERSION ? { settings } : { settings, migratedFrom: m.from };
}

/** Settings persisted in localStorage with a subscribe API. Storage errors never break the game. */
export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<SettingsListener>();

  constructor(
    private readonly storage: StorageLike | undefined,
    migrations: Migrations = MIGRATIONS,
  ) {
    let text: string | null = null;
    try {
      text = storage?.getItem(SETTINGS_STORAGE_KEY) ?? null;
    } catch {
      // Storage disabled (privacy mode): run on defaults.
    }
    const r = loadSettings(text, migrations);
    this.current = r.settings;
    if (r.fallback) console.warn(`Ustawienia: ${r.fallback} — używam domyślnych`);
    if (r.migratedFrom !== undefined) this.persist();
  }

  get(): Settings {
    return this.current;
  }

  /** Applies `recipe` (pure: return a new object), validates, persists and notifies. */
  update(recipe: (s: Settings) => Settings): Settings {
    const prev = this.current;
    const next = sanitizeSettings(recipe(prev));
    this.current = next;
    this.persist();
    for (const l of this.listeners) l(next, prev);
    return next;
  }

  reset(): Settings {
    return this.update(() => DEFAULT_SETTINGS);
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(): void {
    try {
      this.storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      // Quota / disabled storage: keep the in-memory settings.
    }
  }
}

/** Browser store (localStorage may be missing or throw on access). */
export function createSettingsStore(): SettingsStore {
  let storage: StorageLike | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return new SettingsStore(storage);
}
