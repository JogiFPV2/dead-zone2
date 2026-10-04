import { describe, expect, it } from 'vitest';
import { DEFAULT_HUD_LAYOUT } from '../hud-layout/defaults.js';
import {
  PLAYER_SETTINGS_MAX_BYTES,
  playerSettingsSchema,
  type PlayerSettings,
} from './player-settings.js';
import {
  defaultPlayerSettings,
  playerSettingsByteSize,
  resolveSettings,
  utf8ByteLength,
  validatePlayerSettings,
} from './resolve.js';

describe('playerSettingsSchema', () => {
  it('defaults match the client defaults (apps/game settings/schema.ts)', () => {
    const d = defaultPlayerSettings();
    expect(d.version).toBe(1);
    expect(d.graphics).toEqual({
      style: 'classic',
      pixelRatioCap: 2,
      antialias: true,
      showFps: false,
      viewDistance: 'medium',
      uiScale: 0.9,
    });
    expect(d.interface).toEqual({
      noiseDisplay: 'loud',
      showZombieHp: false,
      targetZombieHp: true,
    });
    expect(d.audio.master).toBe(0.8);
    expect(d.view.bigMapLayers).toEqual({ markers: true, trail: true, grid: false });
    expect(d.view.inventorySort.player).toEqual({ by: 'category', desc: false });
    expect(d.input.bindings).toEqual({});
    expect(d.hud).toEqual({ version: 1, elements: {} });
    expect(playerSettingsSchema.safeParse(d).success).toBe(true);
  });

  it('strips unknown keys and rejects out-of-range values', () => {
    const r = playerSettingsSchema.parse({ junk: 1, graphics: { style: 'pixel-fine', x: 2 } });
    expect(r).not.toHaveProperty('junk');
    expect(r.graphics).not.toHaveProperty('x');
    expect(r.graphics.style).toBe('pixel-fine');
    const bad = [
      { graphics: { style: 'neon' } },
      { graphics: { viewDistance: 'ultra' } },
      { graphics: { uiScale: 2 } },
      { audio: { master: 1.2 } },
      { interface: { noiseDisplay: 'sometimes' } },
      { view: { cameraZoom: 0 } },
      { input: { bindings: { interact: ['KeyF', 'KeyG', 'KeyH'] } } },
      { input: { bindings: { 'bad key': ['KeyF'] } } },
      {
        hud: {
          version: 1,
          elements: { status: { anchor: 'tl', x: 0, y: 0, scale: 3, opacity: 1 } },
        },
      },
      { version: 2 },
    ];
    for (const b of bad)
      expect(playerSettingsSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });
});

describe('resolveSettings', () => {
  it('falls back per field and drops unknown keys', () => {
    const s = resolveSettings({
      graphics: { style: 'outline', viewDistance: 'ultra', uiScale: 1.1 },
      audio: { music: 7, muted: true },
      input: { bindings: { interact: ['KeyG'], 'bad key': ['KeyF'], reload: 'R' } },
      hud: {
        version: 1,
        elements: { minimap: { ...DEFAULT_HUD_LAYOUT.elements.minimap, scale: 1.3 }, status: 5 },
      },
      future: { x: 1 },
    });
    expect(s.graphics.style).toBe('outline');
    expect(s.graphics.viewDistance).toBe('medium');
    expect(s.graphics.uiScale).toBe(1.1);
    expect(s.audio.music).toBe(0.45);
    expect(s.audio.muted).toBe(true);
    expect(s.input.bindings).toEqual({ interact: ['KeyG'] });
    expect(s.hud.elements.minimap?.scale).toBe(1.3);
    expect(s.hud.elements).not.toHaveProperty('status');
    expect(s).not.toHaveProperty('future');
    expect(playerSettingsSchema.safeParse(s).success).toBe(true);
  });

  it('garbage or another version → defaults', () => {
    for (const bad of [undefined, null, 'x', 3, [], { version: 2, audio: { muted: true } }]) {
      expect(resolveSettings(bad)).toEqual(defaultPlayerSettings());
    }
  });
});

describe('size limit', () => {
  it('counts UTF-8 bytes', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('ł')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });

  it('defaults and a fully customised HUD fit with a large margin', () => {
    expect(playerSettingsByteSize(defaultPlayerSettings())).toBeLessThan(
      PLAYER_SETTINGS_MAX_BYTES / 8,
    );
    const full: PlayerSettings = {
      ...defaultPlayerSettings(),
      hud: { version: 1, elements: { ...DEFAULT_HUD_LAYOUT.elements } },
      input: {
        bindings: Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`action${i}`, ['KeyA', 'WheelDown']]),
        ),
      },
    };
    expect(validatePlayerSettings(full).ok).toBe(true);
    expect(playerSettingsByteSize(full)).toBeLessThan(PLAYER_SETTINGS_MAX_BYTES / 2);
  });

  it('validatePlayerSettings rejects too large and invalid input', () => {
    const big = { pad: 'x'.repeat(PLAYER_SETTINGS_MAX_BYTES) };
    expect(validatePlayerSettings(big)).toMatchObject({ ok: false, reason: 'too-large' });
    expect(validatePlayerSettings({ audio: { master: 3 } })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    const ok = validatePlayerSettings({ graphics: { style: 'pixel' }, extra: 1 });
    expect(ok.ok && ok.data.graphics.style).toBe('pixel');
    expect(ok.ok && 'extra' in ok.data).toBe(false);
  });
});
