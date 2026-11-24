import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import {
  activateRow,
  adjustRow,
  chooseRow,
  isDirty,
  isFocusable,
  setSlider,
  settingsRows,
  type FocusableRow,
} from './settings-rows.js';
import { SETTINGS_TABS } from './settings-tabs.js';

const ctx = { trackTitle: 'EmptyCity', viewport: { width: 1280, height: 720 } };
// The style rows are checked from „Klasyczny” (the default is „Malowany” since 24.11.2026).
const d: typeof DEFAULT_SETTINGS = {
  ...DEFAULT_SETTINGS,
  graphics: { ...DEFAULT_SETTINGS.graphics, style: 'classic' },
};
const row = (tab: Parameters<typeof settingsRows>[0], id: string, s = d): FocusableRow =>
  settingsRows(tab, s, ctx)
    .filter(isFocusable)
    .find((r) => r.id === id)!;

describe('settings rows', () => {
  it('every tab has its own content', () => {
    const labels = SETTINGS_TABS.map((t) =>
      JSON.stringify(settingsRows(t.id, d, ctx).map((r) => r.label)),
    );
    expect(new Set(labels).size).toBe(SETTINGS_TABS.length);
    for (const t of SETTINGS_TABS) expect(settingsRows(t.id, d, ctx).length).toBeGreaterThan(1);
  });

  it('Grafika: style choice cycles and the resolution shows the viewport', () => {
    const style = row('graphics', 'style');
    expect(adjustRow(d, style, 'ArrowRight', false).graphics.style).toBe('outline');
    expect(adjustRow(d, style, 'ArrowLeft', false).graphics.renderStyle).toBe('real');
    expect(JSON.stringify(settingsRows('graphics', d, ctx))).toContain('Pikselowy ostry');
    expect(activateRow(d, style).graphics.style).toBe('outline');
    const q = row('graphics', 'quality');
    expect(adjustRow(d, q, 'ArrowLeft', false).graphics.pixelRatioCap).toBe(1.5);
    expect(JSON.stringify(settingsRows('graphics', d, ctx))).toContain('1280 × 720');
  });

  it('Grafika: Styl grafiki also holds Realistyczny (graphics.renderStyle), one row', () => {
    const rows = settingsRows('graphics', d, ctx);
    expect(JSON.stringify(rows)).not.toContain('Wygląd świata');
    const r = row('graphics', 'style');
    expect(r).toMatchObject({ kind: 'choice', label: 'Styl grafiki', value: 'classic' });
    expect(JSON.stringify(r)).toContain('Realistyczny');
    const real = chooseRow(d, 'style', 'real');
    expect(real.graphics.renderStyle).toBe('real');
    expect(real.graphics.style).toBe('classic');
    expect(isDirty(real, d)).toBe(true);
    expect(row('graphics', 'style', real)).toMatchObject({ value: 'real' });
    // A low-poly look again switches the realistic style off.
    const pixel = chooseRow(real, 'style', 'pixel');
    expect(pixel.graphics).toMatchObject({ style: 'pixel', renderStyle: 'default' });
    expect(adjustRow(real, r, 'ArrowRight', false).graphics.renderStyle).toBe('default');
  });

  it('Grafika: Zasięg widzenia steps Niski / Średni / Wysoki (the ?view= presets)', () => {
    const v = row('graphics', 'viewDistance');
    expect(v).toMatchObject({ kind: 'choice', label: 'Zasięg widzenia', value: 'medium' });
    expect(JSON.stringify(v)).toContain('Niski');
    expect(adjustRow(d, v, 'ArrowLeft', false).graphics.viewDistance).toBe('low');
    expect(adjustRow(d, v, 'ArrowRight', false).graphics.viewDistance).toBe('high');
    expect(isDirty(adjustRow(d, v, 'ArrowRight', false), d)).toBe(true);
  });

  it('Dźwięk sliders step by 5 (Shift 1); Interfejs toggles', () => {
    const master = row('audio', 'master');
    expect(adjustRow(d, master, 'ArrowRight', false).audio.master).toBe(0.85);
    expect(adjustRow(d, master, 'ArrowLeft', true).audio.master).toBe(0.79);
    expect(adjustRow(d, master, 'Home', false).audio.master).toBe(0);
    const hp = row('interface', 'showZombieHp');
    expect(activateRow(d, hp).interface.showZombieHp).toBe(true);
    expect(isDirty(activateRow(d, hp), d)).toBe(true);
    expect(isDirty(d, d)).toBe(false);
  });

  it('Grafika: Skala interfejsu 60–120 % in 5 % steps, shown as a percentage', () => {
    const r = row('graphics', 'uiScale');
    expect(r).toMatchObject({ kind: 'slider', display: '90%' });
    expect(r.kind === 'slider' && r.value).toBeCloseTo(0.5);
    expect(adjustRow(d, r, 'ArrowRight', false).graphics.uiScale).toBe(0.95);
    expect(adjustRow(d, r, 'ArrowLeft', true).graphics.uiScale).toBe(0.85);
    expect(adjustRow(d, r, 'Home', false).graphics.uiScale).toBe(0.6);
    expect(adjustRow(d, r, 'End', false).graphics.uiScale).toBe(1.2);
    const max = adjustRow(d, r, 'End', false);
    expect(adjustRow(max, r, 'ArrowRight', false)).toBe(max);
    expect(setSlider(d, 'uiScale', 0).graphics.uiScale).toBe(0.6);
    expect(setSlider(d, 'uiScale', 2 / 3).graphics.uiScale).toBe(1);
    expect(isDirty(setSlider(d, 'uiScale', 1), d)).toBe(true);
  });

  it('Interfejs: Układ HUD first — EDYTUJ HUD (game only), Skala, Resetuj układ', () => {
    const rows = settingsRows('interface', d, ctx).filter(isFocusable);
    expect(rows.slice(0, 3).map((r) => r.id)).toEqual(['editHud', 'uiScale', 'resetHud']);
    expect(rows[0]).toMatchObject({ kind: 'button', button: 'EDYTUJ HUD', disabled: true });
    expect(rows[2]).toMatchObject({ kind: 'button', disabled: true });
    const custom = {
      version: 1 as const,
      elements: {
        minimap: {
          anchor: 'tr' as const,
          x: 0.01,
          y: 0.02,
          scale: 0.7,
          opacity: 0.55,
          visible: true,
        },
        hotbar: { anchor: 'bc' as const, x: 0, y: 0.03, scale: 1.2, opacity: 1, visible: true },
      },
    };
    const inGame = settingsRows('interface', d, {
      ...ctx,
      hudEditor: true,
      hudLayout: custom,
    }).filter(isFocusable);
    expect(inGame[0]).toMatchObject({ disabled: false });
    expect(JSON.stringify(inGame[0])).toContain('własny');
    expect(JSON.stringify(inGame[0])).toContain('2 zmienione elementy');
    expect(inGame[2]).toMatchObject({ disabled: false });
  });

  it('Interfejs: Pokazuj hałas, Tylko głośne by default, ←/→ steps', () => {
    const n = row('interface', 'noiseDisplay');
    expect(n).toMatchObject({ label: 'Pokazuj hałas', value: 'loud' });
    expect(adjustRow(d, n, 'ArrowLeft', false).interface.noiseDisplay).toBe('off');
    expect(adjustRow(d, n, 'ArrowRight', false).interface.noiseDisplay).toBe('always');
    expect(adjustRow(d, n, 'Home', false).interface.noiseDisplay).toBe('off');
    expect(isDirty(adjustRow(d, n, 'End', false), d)).toBe(true);
    expect(JSON.stringify(n)).toContain('Ściany i piętra go skracają');
  });

  it('Sterowanie lists the current bindings', () => {
    const text = JSON.stringify(settingsRows('controls', d, ctx));
    expect(text).toContain('W · A · S · D');
    expect(text).toContain('Esc');
  });
});
