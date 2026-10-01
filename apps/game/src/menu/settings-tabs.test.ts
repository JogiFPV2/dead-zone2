import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS, settingsKey, stepSettingsFocus, stepTab } from './settings-tabs.js';

const none = { ctrl: false, shift: false };
const rows = { zone: 'row', index: 0 } as const;
const tabs = { zone: 'tabs' } as const;

describe('settings tabs', () => {
  it('has the five mockup tabs and wraps when stepping', () => {
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual([
      'Grafika',
      'Dźwięk',
      'Sterowanie',
      'Rozgrywka',
      'Interfejs',
    ]);
    expect(stepTab('graphics', 1)).toBe('audio');
    expect(stepTab('graphics', -1)).toBe('interface');
    expect(stepTab('interface', 1)).toBe('graphics');
  });

  it('switches tabs with Q/E and Ctrl+Tab (Shift = back) wherever the focus is', () => {
    for (const f of [tabs, rows]) {
      expect(settingsKey('KeyQ', none, f)).toEqual({ type: 'tab', delta: -1 });
      expect(settingsKey('KeyE', none, f)).toEqual({ type: 'tab', delta: 1 });
      expect(settingsKey('Tab', { ctrl: true, shift: false }, f)).toEqual({
        type: 'tab',
        delta: 1,
      });
      expect(settingsKey('Tab', { ctrl: true, shift: true }, f)).toEqual({
        type: 'tab',
        delta: -1,
      });
    }
  });

  it('←/→ switch tabs on the tab strip and adjust rows in the content', () => {
    expect(settingsKey('ArrowRight', none, tabs)).toEqual({ type: 'tab', delta: 1 });
    expect(settingsKey('ArrowLeft', none, tabs)).toEqual({ type: 'tab', delta: -1 });
    expect(settingsKey('ArrowLeft', { ctrl: false, shift: true }, rows)).toEqual({
      type: 'adjust',
      dir: -1,
      fine: true,
    });
    expect(settingsKey('Escape', none, rows)).toEqual({ type: 'back' });
    expect(settingsKey('Enter', none, rows)).toEqual({ type: 'apply' });
    expect(settingsKey('KeyZ', none, rows)).toBeUndefined();
  });

  it('moves the focus through the tab strip and the rows', () => {
    expect(stepSettingsFocus(tabs, 1, 3)).toEqual({ zone: 'row', index: 0 });
    expect(stepSettingsFocus({ zone: 'row', index: 2 }, 1, 3)).toEqual(tabs);
    expect(stepSettingsFocus(tabs, -1, 3)).toEqual({ zone: 'row', index: 2 });
    expect(stepSettingsFocus(tabs, 1, 0)).toEqual(tabs);
  });
});
