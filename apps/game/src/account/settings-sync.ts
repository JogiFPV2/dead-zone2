import type {
  CloudAttachable,
  PlayerSettings,
  PlayerSettingsStore,
} from '../settings/player-settings-store.js';
import type { AccountApi, IfMatch } from './account-api.js';

export interface SettingsSyncOptions {
  api: Pick<AccountApi, 'getSettings' | 'putSettings'>;
  store: Pick<PlayerSettingsStore, 'load' | 'subscribe'> & CloudAttachable;
  /** Wait after the last change before `PUT` (sliders send many changes). */
  debounceMs?: number;
}

export interface SettingsSync {
  /** Version of the server copy this client last saw (`If-Match`). */
  readonly version: number;
  /** Pending upload finished (tests, „Wyloguj”). */
  flush(): Promise<void>;
  stop(): void;
}

/**
 * Cloud copy of the whole settings object (`GET`/`PUT /v1/me/settings`, Serwer #164). On login
 * the server copy (if any) replaces the local one; with nothing stored yet (version 0) the local
 * settings become the cloud copy. Later local changes (settings screens, HUD editor) go up with
 * `If-Match`. A 412 (another device saved first) pulls the server copy, which wins here — two
 * devices never silently overwrite each other. 413 / 422 / 428 are logged and leave the local
 * copy as it is (the store validates with the same schema, so they mean a client bug).
 */
export async function startSettingsSync(o: SettingsSyncOptions): Promise<SettingsSync> {
  const debounceMs = o.debounceMs ?? 1500;
  let version = 0;
  /** `If-Match` of the next PUT: the ETag exactly as received (`W/"3"`), else the version. */
  let tag: IfMatch = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> = Promise.resolve();
  const state = (s: Parameters<CloudAttachable['setCloud']>[0]): void => {
    if (!stopped) o.store.setCloud(s, flush);
  };

  async function pull(): Promise<boolean> {
    const r = await o.api.getSettings();
    if (stopped) return false;
    if (!r.ok) {
      state('error');
      return false;
    }
    version = r.version;
    tag = r.etag ?? r.version;
    if (r.version > 0 && r.settings) o.store.applyRemote(r.settings);
    state('synced');
    return true;
  }

  async function push(s: PlayerSettings): Promise<void> {
    if (stopped) return;
    state('syncing');
    const r = await o.api.putSettings(s, tag);
    if (stopped) return;
    if (r.ok) {
      version = r.version;
      tag = r.etag ?? r.version;
      state('synced');
    } else if (r.reason === 'conflict') {
      await pull();
    } else {
      if (r.reason === 'too-large' || r.reason === 'invalid' || r.reason === 'precondition') {
        console.warn(`Ustawienia w chmurze: serwer odrzucił zapis (${r.reason})`, r);
      }
      state('error');
    }
  }

  function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
      inflight = inflight.then(() => push(o.store.load()));
    }
    return inflight;
  }

  state('syncing');
  const pulled = await pull();
  if (pulled && version === 0) await push(o.store.load());

  const unsub = o.store.subscribe((next, origin) => {
    if (origin === 'remote' || stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      inflight = inflight.then(() => push(next));
    }, debounceMs);
  });

  return {
    get version() {
      return version;
    },
    flush,
    stop() {
      if (timer !== undefined) clearTimeout(timer);
      stopped = true;
      unsub();
      o.store.setCloud('off');
    },
  };
}
