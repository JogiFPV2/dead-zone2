// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../settings/store.js';
import { createSettingsScreen } from './settings-screen.js';
import { SETTINGS_TABS } from './settings-tabs.js';

const key = (code: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });

function setup() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const settings = new SettingsStore(undefined);
  const onClose = vi.fn();
  const screen = createSettingsScreen({
    root,
    settings,
    audio: { play: vi.fn(), preview: vi.fn() },
    trackTitle: 'EmptyCity',
    onClose,
  });
  const panel = () => root.querySelector<HTMLElement>('[role="tabpanel"]')!;
  const selected = () => root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
  const tab = (id: string) => root.querySelector<HTMLElement>(`[data-tab="${id}"]`)!;
  return { root, settings, screen, onClose, panel, selected, tab };
}

afterEach(() => {
  document.body.innerHTML = '';
});

// Regression: in #63 only „Audio” worked; the other tabs were inert placeholders.
describe('settings screen tabs', () => {
  it('every tab is a clickable, enabled button that switches the content', () => {
    const { panel, selected, tab, screen } = setup();
    const seen = new Set<string>();
    for (const t of SETTINGS_TABS) {
      const el = tab(t.id);
      expect(el.tagName).toBe('BUTTON');
      expect(el.getAttribute('aria-disabled')).toBeNull();
      tab(t.id).click();
      expect(screen.tab).toBe(t.id);
      expect(selected().dataset.tab).toBe(t.id);
      expect(panel().dataset.panel).toBe(t.id);
      seen.add(panel().innerHTML);
    }
    expect(seen.size).toBe(SETTINGS_TABS.length);
    screen.dispose();
  });

  it('Q/E, Ctrl+Tab and ←/→ on the tab strip switch tabs from the keyboard', () => {
    const { screen, selected } = setup();
    expect(selected().dataset.tab).toBe('graphics');
    expect(screen.onKey(key('KeyE'))).toBe(true);
    expect(selected().dataset.tab).toBe('audio');
    screen.onKey(key('KeyQ'));
    screen.onKey(key('KeyQ'));
    expect(selected().dataset.tab).toBe('interface');
    screen.onKey(key('Tab', { ctrlKey: true }));
    expect(selected().dataset.tab).toBe('graphics');
    screen.onKey(key('Tab', { ctrlKey: true, shiftKey: true }));
    expect(selected().dataset.tab).toBe('interface');
    screen.onKey(key('ArrowRight'));
    expect(selected().dataset.tab).toBe('graphics');
    screen.dispose();
  });

  it('edits a draft and saves it on Zastosuj (Enter)', () => {
    const { screen, settings, tab, root, onClose } = setup();
    tab('interface').click();
    // Rows 0–2 = Układ HUD, row 3 = Pokazuj hałas (card with a preview), row 4 = Pokazuj życie zombie.
    root.querySelector<HTMLElement>('[data-row="3"] [data-opt="always"]')!.click();
    expect(root.querySelector('.dzo-preview-tag')!.textContent).toContain('CHÓD');
    root.querySelector<HTMLElement>('[data-row="4"]')!.click();
    expect(settings.get().interface.showZombieHp).toBe(false);
    screen.onKey(key('Enter'));
    expect(settings.get().interface.showZombieHp).toBe(true);
    expect(settings.get().interface.noiseDisplay).toBe('always');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.dzo')).toBeNull();
  });

  it('Esc with changes asks before discarding; without changes closes', () => {
    const { screen, settings, root, onClose } = setup();
    root.querySelector<HTMLElement>('[data-opt="pixel"]')!.click();
    screen.onKey(key('Escape'));
    expect(root.querySelector('.dzo-confirm')).not.toBeNull();
    screen.onKey(key('Escape'));
    expect(root.querySelector('.dzo-confirm')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    screen.onKey(key('Escape'));
    screen.onKey(key('Enter'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(settings.get().graphics.style).toBe('classic');
  });
});
