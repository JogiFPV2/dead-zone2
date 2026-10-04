import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import {
  HUD_LAYOUT_STORAGE_KEY,
  LocalPlayerSettingsStore,
  type PlayerSettings,
} from '../settings/player-settings-store.js';
import { SettingsStore } from '../settings/store.js';
import { AccountSession, OFFLINE_CHOICE_KEY } from './account-session.js';
import { createMockAccountApi } from './mock-api.js';
import { startSettingsSync } from './settings-sync.js';

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

const player = (storage = memory()) => {
  const local = new SettingsStore(storage);
  return { local, store: new LocalPlayerSettingsStore(local, storage), storage };
};
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('PlayerSettingsStore', () => {
  it('load = client settings + HUD layout; save validates, persists both and notifies', () => {
    const { local, store, storage } = player();
    const seen: string[] = [];
    store.subscribe((_s, origin) => seen.push(origin));
    const p = store.load();
    expect(p.version).toBe(1);
    expect(p.audio.master).toBe(DEFAULT_SETTINGS.audio.master);
    const hud = {
      version: 1,
      elements: { minimap: { anchor: 'tl', x: 0.02, y: 0.03, scale: 1.2, opacity: 0.6 } },
    };
    const r = store.save({ ...p, hud } as PlayerSettings);
    expect(r.ok).toBe(true);
    expect(store.load().hud.elements.minimap?.scale).toBe(1.2);
    expect(JSON.parse(storage.getItem(HUD_LAYOUT_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: 1,
    });
    // Settings screens keep using the game store; the adapter sees those changes too.
    local.update((s) => ({ ...s, audio: { ...s.audio, music: 0.4 } }));
    expect(store.load().audio.music).toBe(0.4);
    expect(seen).toEqual(['local', 'local']);
    // A fresh store over the same storage restores the layout.
    expect(player(storage).store.load().hud.elements.minimap?.opacity).toBe(0.6);
  });

  it('invalid or oversized objects change nothing', () => {
    const { store } = player();
    const p = store.load();
    const bad = store.save({ ...p, audio: { ...p.audio, master: 7 } });
    expect(bad).toMatchObject({ ok: false, reason: 'invalid' });
    const big = store.save({ ...p, junk: 'x'.repeat(20_000) } as PlayerSettings);
    expect(big).toMatchObject({ ok: false, reason: 'too-large' });
    expect(store.load()).toEqual(p);
    expect(store.cloud).toBe('off');
  });
});

describe('cloud settings (GET/PUT /v1/me/settings)', () => {
  it('first login uploads the local object; later changes go up with If-Match', async () => {
    const api = createMockAccountApi({ latencyMs: 0, signedInAs: 'google' });
    const { local, store } = player();
    const sync = await startSettingsSync({ api, store, debounceMs: 0 });
    expect(sync.version).toBe(1);
    expect(store.cloud).toBe('synced');
    local.update((s) => ({ ...s, audio: { ...s.audio, master: 0.3 } }));
    await tick();
    await store.flush();
    expect(sync.version).toBe(2);
    const remote = await api.getSettings();
    expect(remote.ok && (remote.settings as PlayerSettings).audio.master).toBe(0.3);
    expect(remote.ok && (remote.settings as PlayerSettings).version).toBe(1);
    sync.stop();
    expect(store.cloud).toBe('off');
  });

  it('a newer server copy (another device, 412) replaces the local one', async () => {
    const api = createMockAccountApi({ latencyMs: 0, signedInAs: 'google' });
    const base = player().store.load();
    await api.putSettings({ ...base, audio: { ...base.audio, music: 0.1 } }, 0);
    const { local, store } = player();
    const sync = await startSettingsSync({ api, store, debounceMs: 0 });
    expect(local.get().audio.music).toBe(0.1);
    await api.putSettings({ ...base, audio: { ...base.audio, music: 0.7 } }, 1);
    local.update((s) => ({ ...s, audio: { ...s.audio, master: 0.2 } }));
    await tick();
    await sync.flush();
    expect(local.get().audio.music).toBe(0.7);
    expect(sync.version).toBe(2);
    sync.stop();
  });

  it('a network error marks the cloud copy as failed and keeps the local one', async () => {
    const api = createMockAccountApi({ latencyMs: 0 }); // no session → 401
    const { store } = player();
    await startSettingsSync({ api, store, debounceMs: 0 });
    expect(store.cloud).toBe('error');
  });
});

describe('AccountSession', () => {
  it('online without a session asks for login until „Graj offline” (remembered)', async () => {
    const storage = memory();
    const s = new AccountSession({ api: createMockAccountApi({ latencyMs: 0 }), storage });
    await s.restore();
    expect(s.needsLogin).toBe(true);
    s.chooseOffline();
    expect(s.needsLogin).toBe(false);
    expect(storage.getItem(OFFLINE_CHOICE_KEY)).toBe('1');
    expect(new AccountSession({ api: createMockAccountApi(), storage }).needsLogin).toBe(false);
  });

  it('offline API never asks; restore + sign out; expiry keeps the e-mail and a toast', async () => {
    const off = new AccountSession({
      api: createMockAccountApi({ latencyMs: 0, signedInAs: 'google' }),
    });
    await off.restore();
    expect(off.cloud).toBe(true);
    off.expired();
    expect(off.cloud).toBe(false);
    expect(off.lastEmail).toBe('pawel.rosol@gmail.com');
    expect(off.pendingToast).toBe('Sesja wygasła. Zaloguj się ponownie.');
    const { createOfflineAccountApi } = await import('./offline-api.js');
    expect(new AccountSession({ api: createOfflineAccountApi() }).needsLogin).toBe(false);
  });
});
