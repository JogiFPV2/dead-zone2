// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HudLayout } from '@deadzone/ui/settings';
import { SettingsStore } from '../settings/store.js';
import {
  HUD_LAYOUT_STORAGE_KEY,
  LocalPlayerSettingsStore,
} from '../settings/player-settings-store.js';
import { createSettingsScreen } from './settings-screen.js';

const CUSTOM: HudLayout = {
  version: 1,
  elements: { minimap: { anchor: 'tr', x: 0, y: 0, scale: 0.7, opacity: 0.55, visible: true } },
};

function setup(withEditor: boolean) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  const settings = new SettingsStore(undefined);
  const player = new LocalPlayerSettingsStore(settings, storage);
  player.save({ ...player.load(), hud: CUSTOM });
  const onClose = vi.fn();
  const onEditHud = vi.fn();
  createSettingsScreen({
    root,
    settings,
    player,
    audio: { play: vi.fn(), preview: vi.fn() },
    trackTitle: 'EmptyCity',
    initialTab: 'interface',
    onClose,
    ...(withEditor ? { onEditHud } : {}),
  });
  return { root, player, mem, onClose, onEditHud };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Ustawienia › Interfejs › Układ HUD', () => {
  it('shows the custom layout and its preview; EDYTUJ HUD hands over the draft', () => {
    const { root, onEditHud } = setup(true);
    expect(root.textContent).toContain('własny');
    expect(root.querySelector('.dzo-hudpv')).not.toBeNull();
    root.querySelector<HTMLElement>('[data-btn="editHud"]')!.click();
    expect(onEditHud).toHaveBeenCalledOnce();
    expect((onEditHud.mock.calls[0]![0] as { hud: HudLayout }).hud).toEqual(CUSTOM);
    expect(root.querySelector('.dzo--settings')).toBeNull();
  });

  it('EDYTUJ HUD is disabled outside the game', () => {
    const { root } = setup(false);
    const b = root.querySelector<HTMLButtonElement>('[data-btn="editHud"]')!;
    expect(b.disabled || b.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(root.textContent).toContain('edycja w trakcie gry');
  });

  it('Resetuj układ asks, then Zastosuj saves the default layout to deadzone.hudLayout', () => {
    const { root, player, mem, onClose } = setup(true);
    root.querySelector<HTMLElement>('[data-btn="resetHud"]')!.click();
    expect(root.textContent).toContain('PRZYWRÓCIĆ DOMYŚLNY UKŁAD HUD?');
    root.querySelector<HTMLElement>('.dzo-confirm [data-answer="yes"]')!.click();
    expect(root.textContent).toContain('domyślny');
    root.querySelector<HTMLElement>('[data-act="apply"]')!.click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(player.load().hud.elements).toEqual({});
    expect(JSON.parse(mem.get(HUD_LAYOUT_STORAGE_KEY)!)).toMatchObject({ elements: {} });
  });
});
