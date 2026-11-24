import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BINDINGS } from '../input/bindings.js';
import { migrate } from './migrate.js';
import { rebindAction } from './rebind.js';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, sanitizeSettings, type Settings } from './schema.js';
import {
  MIGRATIONS,
  SETTINGS_STORAGE_KEY,
  SettingsStore,
  loadSettings,
  type StorageLike,
} from './store.js';

function memoryStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(SETTINGS_STORAGE_KEY, initial);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('sanitizeSettings', () => {
  it('fills defaults field by field and clamps numbers', () => {
    const s = sanitizeSettings({
      version: 1,
      graphics: { pixelRatioCap: 99, antialias: 'yes' },
      audio: { master: -1, music: 0.3 },
    });
    expect(s.graphics).toEqual({
      style: 'painted',
      pixelRatioCap: 4,
      antialias: true,
      showFps: false,
      viewDistance: 'medium',
      uiScale: 0.9,
      renderStyle: 'default',
    });
    expect(s.audio).toEqual({
      master: 0,
      music: 0.3,
      effects: 0.85,
      ambience: 0.7,
      voice: 0.6,
      menuMusic: true,
      muted: false,
    });
    expect(s.input.bindings).toEqual(DEFAULT_BINDINGS);
    expect(sanitizeSettings('junk')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps view zoom (clamped) and defaults it for files without it', () => {
    const layers = { markers: true, trail: true, grid: false };
    const inv = {
      inventoryView: 'list',
      inventorySort: {
        player: { by: 'category', desc: false },
        container: { by: 'category', desc: false },
      },
      inventoryGroup: true,
    };
    expect(sanitizeSettings({ version: SETTINGS_VERSION }).view).toEqual({
      cameraZoom: 1,
      minimapZoom: 1,
      bigMapZoom: 1,
      bigMapLayers: layers,
      ...inv,
      osmZoom: 16,
    });
    expect(
      sanitizeSettings({
        view: {
          cameraZoom: 1.4,
          minimapZoom: 99,
          bigMapZoom: 0.01,
          bigMapLayers: { grid: true },
          inventoryView: 'grid',
          inventorySort: { player: { by: 'weight', desc: true }, container: { by: 'bogus' } },
          inventoryGroup: false,
          osmZoom: 25,
        },
      }).view,
    ).toEqual({
      cameraZoom: 1.4,
      minimapZoom: 4,
      bigMapZoom: 0.05,
      bigMapLayers: { ...layers, grid: true },
      inventoryView: 'grid',
      inventorySort: {
        player: { by: 'weight', desc: true },
        container: { by: 'category', desc: false },
      },
      inventoryGroup: false,
      osmZoom: 19,
    });
  });
});

describe('migrate', () => {
  const chain = {
    0: (d: Record<string, unknown>) => ({ ...d, a: 1 }),
    1: (d: Record<string, unknown>) => ({ ...d, b: Number(d.a) + 1 }),
  };

  it('runs the chain from the stored version (missing version = 0)', () => {
    expect(migrate({}, 2, chain)).toEqual({ ok: true, data: { a: 1, b: 2, version: 2 }, from: 0 });
    expect(migrate({ version: 1, a: 5 }, 2, chain)).toMatchObject({ ok: true, data: { b: 6 } });
    expect(migrate({ version: 2 }, 2, chain)).toMatchObject({ ok: true, from: 2 });
  });

  it('fails on newer, invalid, missing or throwing steps', () => {
    expect(migrate({ version: 3 }, 2, chain)).toMatchObject({ ok: false });
    expect(migrate({ version: 'x' }, 2, chain)).toMatchObject({ ok: false });
    expect(migrate([], 2, chain)).toMatchObject({ ok: false });
    const missing = migrate({}, 3, chain);
    expect(!missing.ok && missing.reason).toMatch(/2→3/);
    const boom = {
      0: () => {
        throw new Error('x');
      },
    };
    expect(migrate({}, 1, boom)).toMatchObject({ ok: false });
  });
});

describe('loadSettings', () => {
  it('falls back to defaults on missing, corrupt or future data', () => {
    expect(loadSettings(null)).toEqual({ settings: DEFAULT_SETTINGS });
    expect(loadSettings('{oops')).toMatchObject({
      settings: DEFAULT_SETTINGS,
      fallback: 'uszkodzony JSON',
    });
    expect(loadSettings(JSON.stringify({ version: SETTINGS_VERSION + 1 })).fallback).toMatch(
      /nowsza/,
    );
  });

  it('v1 → v2 keeps the data and adds the zombie health interface defaults', () => {
    const r = loadSettings(JSON.stringify({ version: 1, audio: { muted: true } }));
    expect(r.migratedFrom).toBe(1);
    expect(r.settings.audio.muted).toBe(true);
    expect(r.settings.interface).toEqual({
      noiseDisplay: 'loud',
      showZombieHp: false,
      targetZombieHp: true,
      revealMap: false,
      tutorial: true,
      osmMap: false,
    });
  });

  it('v3 → v5 keeps the data and defaults the graphics style; v4 data loads (#71 builds)', () => {
    const r = loadSettings(
      JSON.stringify({ version: 3, graphics: { pixelRatioCap: 1 }, audio: { muted: true } }),
    );
    expect(r.migratedFrom).toBe(3);
    expect(r.settings.graphics.style).toBe('painted');
    expect(r.settings.graphics.pixelRatioCap).toBe(1);
    expect(r.settings.audio.muted).toBe(true);
    const v4 = loadSettings(JSON.stringify({ version: 4, graphics: { style: 'pixel' } }));
    expect(v4.fallback).toBeUndefined();
    expect(v4.settings.graphics.style).toBe('pixel');
    const fine = loadSettings(JSON.stringify({ version: 4, graphics: { style: 'pixel-fine' } }));
    expect(fine.migratedFrom).toBe(4);
    expect(fine.settings.graphics.style).toBe('pixel-fine');
    expect(sanitizeSettings({ graphics: { style: 'vhs' } }).graphics.style).toBe('painted');
  });

  it('v4 → v5 moves the old default „Klasyczny” to „Malowany” once', () => {
    const r = loadSettings(JSON.stringify({ version: 4, graphics: { style: 'classic' } }));
    expect(r.migratedFrom).toBe(4);
    expect(r.settings.graphics.style).toBe('painted');
    const v5 = loadSettings(JSON.stringify({ version: 5, graphics: { style: 'classic' } }));
    expect(v5.settings.graphics.style).toBe('classic');
  });

  it('migrates legacy data (hypothetical v0 with a flat `keys` map)', () => {
    const v0to1 = (d: Record<string, unknown>) => ({ input: { bindings: d.keys } });
    const r = loadSettings(JSON.stringify({ keys: { moveUp: ['ArrowUp'] } }), {
      ...MIGRATIONS,
      0: v0to1,
    });
    expect(r.migratedFrom).toBe(0);
    expect(r.settings.input.bindings.moveUp).toEqual(['ArrowUp']);
    expect(r.settings.input.bindings.moveDown).toEqual(['KeyS']);
  });
});

describe('SettingsStore', () => {
  it('persists updates and notifies subscribers', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    const listener = vi.fn<(next: Settings) => void>();
    const off = store.subscribe(listener);
    store.update((s) => ({ ...s, audio: { ...s.audio, muted: true } }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].audio.muted).toBe(true);
    expect(new SettingsStore(storage).get().audio.muted).toBe(true);
    off();
    store.reset();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('survives corrupt storage and throwing storage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(new SettingsStore(memoryStorage('not json')).get()).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalled();
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    const store = new SettingsStore(throwing);
    expect(() => store.update((s) => s)).not.toThrow();
    expect(new SettingsStore(undefined).get()).toEqual(DEFAULT_SETTINGS);
    warn.mockRestore();
  });

  it('rewrites migrated data in the current version', () => {
    const storage = memoryStorage(JSON.stringify({ keys: {} }));
    new SettingsStore(storage, { ...MIGRATIONS, 0: () => ({}) });
    expect((JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY)!) as Settings).version).toBe(
      SETTINGS_VERSION,
    );
  });

  it('rebindAction persists on success and reports conflicts', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    expect(rebindAction(store, 'interact', 'KeyQ')).toEqual({
      ok: false,
      conflicts: ['rotateCameraLeft'],
    });
    expect(rebindAction(store, 'interact', 'KeyG').ok).toBe(true);
    expect(new SettingsStore(storage).get().input.bindings.interact).toEqual(['KeyG']);
  });
});

describe('Skala interfejsu (graphics.uiScale)', () => {
  it('defaults to 90 %, clamps to 60–120 % and snaps to 5 % steps', () => {
    expect(DEFAULT_SETTINGS.graphics.uiScale).toBe(0.9);
    const ui = (v: unknown): number =>
      sanitizeSettings({ graphics: { uiScale: v } }).graphics.uiScale;
    expect(ui(undefined)).toBe(0.9);
    expect(ui('big')).toBe(0.9);
    expect(ui(0.3)).toBe(0.6);
    expect(ui(2)).toBe(1.2);
    expect(ui(0.83)).toBe(0.85);
    expect(ui(1.0000001)).toBe(1);
  });
});

describe('Styl grafiki: Realistyczny (graphics.renderStyle)', () => {
  it('defaults to the classic look; bad values fall back, files without it load', () => {
    expect(DEFAULT_SETTINGS.graphics.renderStyle).toBe('default');
    expect(sanitizeSettings({ graphics: { renderStyle: 'ultra' } }).graphics.renderStyle).toBe(
      'default',
    );
    expect(sanitizeSettings({ graphics: { renderStyle: 'real' } }).graphics.renderStyle).toBe(
      'real',
    );
    const old = { ...DEFAULT_SETTINGS, graphics: { ...DEFAULT_SETTINGS.graphics } } as Record<
      string,
      unknown
    >;
    delete (old.graphics as Record<string, unknown>).renderStyle;
    expect(loadSettings(JSON.stringify(old)).settings.graphics.renderStyle).toBe('default');
  });

  it('persists in localStorage and a new store reads it back', () => {
    const storage = memoryStorage();
    new SettingsStore(storage).update((s) => ({
      ...s,
      graphics: { ...s.graphics, renderStyle: 'real' },
    }));
    const saved = JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY)!) as Settings;
    expect(saved.graphics.renderStyle).toBe('real');
    expect(new SettingsStore(storage).get().graphics.renderStyle).toBe('real');
  });
});
