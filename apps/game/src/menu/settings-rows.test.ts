import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import {
  activateRow,
  adjustRow,
  isDirty,
  isFocusable,
  setSlider,
  settingsRows,
  type FocusableRow,
} from './settings-rows.js';
import { SETTINGS_TABS } from './settings-tabs.js';

const ctx = { trackTitle: 'EmptyCity', viewport: { width: 1280, height: 720 } };
const d = DEFAULT_SETTINGS;
const row = (tab: Parameters<typeof settingsRows>[0], id: string): FocusableRow =>
  settingsRows(tab, d, ctx)
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
    expect(adjustRow(d, style, 'ArrowLeft', false).graphics.style).toBe('pixel-fine');
    expect(JSON.stringify(settingsRows('graphics', d, ctx))).toContain('Pikselowy ostry');
    expect(activateRow(d, style).graphics.style).toBe('outline');
    const q = row('graphics', 'quality');
    expect(adjustRow(d, q, 'ArrowLeft', false).graphics.pixelRatioCap).toBe(1.5);
    expect(JSON.stringify(settingsRows('graphics', d, ctx))).toContain('1280 × 720');
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

  it('Interfejs: Pokazuj hałas is the first row, Tylko głośne by default, ←/→ steps', () => {
    const rows = settingsRows('interface', d, ctx).filter(isFocusable);
    expect(rows[0]).toMatchObject({ id: 'noiseDisplay', label: 'Pokazuj hałas', value: 'loud' });
    const n = rows[0]!;
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
