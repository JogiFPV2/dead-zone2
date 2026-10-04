/**
 * Whole player settings object (`PlayerSettings` of `@deadzone/ui/settings`): the client
 * `Settings` (graphics, audio, controls, interface, view) plus the HUD editor layout `hud`.
 *
 * `PlayerSettingsStore` is the one adapter for reading and saving it: locally always
 * (`deadzone.settings` + `deadzone.hudLayout`), and in the cloud (`/v1/me/settings`, If-Match) when
 * an account is signed in — `account/settings-sync.ts` attaches to the store, callers don't change.
 * The HUD editor saves the layout through `save({ ...load(), hud })`.
 */
import {
  PLAYER_SETTINGS_VERSION,
  resolveSettings,
  validatePlayerSettings,
  type HudLayout,
  type PlayerSettings,
} from '@deadzone/ui/settings';
import { SETTINGS_VERSION, sanitizeSettings, type Settings } from './schema.js';
import type { SettingsStore, StorageLike } from './store.js';

export type { PlayerSettings };

/** Local key of the HUD layout (the rest lives in `deadzone.settings`). */
export const HUD_LAYOUT_STORAGE_KEY = 'deadzone.hudLayout';

/** Where the cloud copy stands (shown in Ustawienia › Konto later; `off` = no account). */
export type CloudSettingsState = 'off' | 'syncing' | 'synced' | 'error';

export type PlayerSettingsSaveResult =
  | { ok: true; data: PlayerSettings }
  | { ok: false; reason: 'too-large'; bytes: number }
  | { ok: false; reason: 'invalid'; issues: { path: PropertyKey[]; message: string }[] };

/** Who changed the settings: this client, or the cloud copy replaced them. */
export type SettingsOrigin = 'local' | 'remote';

export type PlayerSettingsListener = (next: PlayerSettings, origin: SettingsOrigin) => void;

export interface PlayerSettingsStore {
  /** Current whole object (local, with the cloud copy applied after sign-in). */
  load(): PlayerSettings;
  /**
   * Validates with `validatePlayerSettings` (16 KB, strict ranges), saves locally and — when
   * signed in — queues the cloud upload. Invalid input changes nothing.
   */
  save(next: PlayerSettings): PlayerSettingsSaveResult;
  subscribe(listener: PlayerSettingsListener): () => void;
  /** Cloud copy state (`off` while offline / logged out). */
  readonly cloud: CloudSettingsState;
  /** Waits for a queued cloud upload (e.g. before „Wyloguj”); resolves at once offline. */
  flush(): Promise<void>;
}

/** Client `Settings` + layout → the cloud object. */
export function toPlayerSettings(s: Settings, hud: unknown): PlayerSettings {
  return resolveSettings({ ...s, version: PLAYER_SETTINGS_VERSION, hud });
}

/** Cloud object → client `Settings` (local version) and the layout. */
export function fromPlayerSettings(p: PlayerSettings): { settings: Settings; hud: HudLayout } {
  return { settings: sanitizeSettings({ ...p, version: SETTINGS_VERSION }), hud: p.hud };
}

/** Hooks for `settings-sync` (not for screens). */
export interface CloudAttachable {
  /** Replaces the settings with the server copy (listeners get origin `remote`). */
  applyRemote(raw: unknown): void;
  setCloud(state: CloudSettingsState, flush?: () => Promise<void>): void;
}

/**
 * Local implementation over the game's `SettingsStore`: settings screens keep using it directly
 * and those changes reach `PlayerSettingsStore` listeners too (origin `local`).
 */
export class LocalPlayerSettingsStore implements PlayerSettingsStore, CloudAttachable {
  private hud: HudLayout;
  private applying: SettingsOrigin | undefined;
  private readonly listeners = new Set<PlayerSettingsListener>();
  private cloudState: CloudSettingsState = 'off';
  private cloudFlush: (() => Promise<void>) | undefined;

  constructor(
    private readonly settings: Pick<SettingsStore, 'get' | 'update' | 'subscribe'>,
    private readonly storage: StorageLike | undefined,
  ) {
    let raw: unknown;
    try {
      const text = storage?.getItem(HUD_LAYOUT_STORAGE_KEY);
      raw = text ? JSON.parse(text) : undefined;
    } catch {
      raw = undefined;
    }
    this.hud = resolveSettings({ hud: raw }).hud;
    settings.subscribe(() => {
      if (this.applying === undefined) this.emit('local');
    });
  }

  get cloud(): CloudSettingsState {
    return this.cloudState;
  }

  load(): PlayerSettings {
    return toPlayerSettings(this.settings.get(), this.hud);
  }

  save(next: PlayerSettings): PlayerSettingsSaveResult {
    const v = validatePlayerSettings(next);
    if (!v.ok) {
      return v.reason === 'too-large'
        ? { ok: false, reason: 'too-large', bytes: v.bytes }
        : {
            ok: false,
            reason: 'invalid',
            issues: v.issues.map((i) => ({ path: i.path, message: i.message })),
          };
    }
    this.write(v.data, 'local');
    return { ok: true, data: this.load() };
  }

  applyRemote(raw: unknown): void {
    const v = validatePlayerSettings(raw);
    // The server only stores validated objects; a lenient read keeps older copies usable.
    this.write(v.ok ? v.data : resolveSettings(raw), 'remote');
  }

  setCloud(state: CloudSettingsState, flush?: () => Promise<void>): void {
    this.cloudState = state;
    if (flush !== undefined || state === 'off') this.cloudFlush = flush;
  }

  flush(): Promise<void> {
    return this.cloudFlush?.() ?? Promise.resolve();
  }

  subscribe(listener: PlayerSettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private write(p: PlayerSettings, origin: SettingsOrigin): void {
    const { settings, hud } = fromPlayerSettings(p);
    this.hud = hud;
    try {
      this.storage?.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify(hud));
    } catch {
      // Quota / disabled storage: keep it in memory.
    }
    this.applying = origin;
    try {
      this.settings.update(() => settings);
    } finally {
      this.applying = undefined;
    }
    this.emit(origin);
  }

  private emit(origin: SettingsOrigin): void {
    const p = this.load();
    for (const l of this.listeners) l(p, origin);
  }
}
