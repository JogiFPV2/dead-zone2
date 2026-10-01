// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../settings/store.js';
import { PauseController, type PauseHost } from './pause-controller.js';

const press = (code: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(e);
  return e;
};

function setup(pausesSim = true) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const simPaused = vi.fn<(p: boolean) => void>();
  const inputSuspended = vi.fn<(s: boolean) => void>();
  const saveAndExit = vi.fn(() => Promise.resolve());
  const host: PauseHost = {
    setSimPaused: simPaused,
    setInputSuspended: inputSuspended,
    info: () => ({ day: 3, minuteOfDay: 600, location: 'Riverside' }),
    lastSave: () => undefined,
    saveAndExit: () => saveAndExit(),
  };
  const pause = new PauseController({
    root,
    settings: new SettingsStore(undefined),
    audio: { play: vi.fn(), preview: vi.fn() },
    trackTitle: 'EmptyCity',
    pausesSim,
    host,
  });
  const gameKeys = vi.fn();
  window.addEventListener('keydown', gameKeys);
  return { root, host, pause, gameKeys, simPaused, inputSuspended, saveAndExit };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PauseController', () => {
  it('pauses the sim and blocks game input; Esc resumes', () => {
    const { pause, root, gameKeys, simPaused, inputSuspended } = setup();
    pause.openMenu();
    expect(pause.simPaused).toBe(true);
    expect(simPaused).toHaveBeenLastCalledWith(true);
    expect(inputSuspended).toHaveBeenLastCalledWith(true);
    expect(root.textContent).toContain('Dzień 3 · 10:00 · Riverside');
    press('KeyI');
    expect(gameKeys).not.toHaveBeenCalled();
    press('Escape');
    expect(pause.open).toBe(false);
    expect(simPaused).toHaveBeenLastCalledWith(false);
    expect(inputSuspended).toHaveBeenLastCalledWith(false);
    expect(root.querySelector('.dzo')).toBeNull();
  });

  it('co-op mode (pausesSim: false) opens the menu without pausing the sim', () => {
    const { pause, simPaused, inputSuspended } = setup(false);
    pause.openMenu();
    expect(pause.open).toBe(true);
    expect(pause.simPaused).toBe(false);
    expect(simPaused).not.toHaveBeenCalled();
    expect(inputSuspended).toHaveBeenLastCalledWith(true);
    pause.close();
  });

  it('Ustawienia opens the settings screen; Esc there returns to the pause menu', () => {
    const { pause, root } = setup();
    pause.openMenu();
    press('ArrowDown');
    press('Enter');
    expect(root.querySelector('[role="tablist"]')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('.dzo--pause')!.hidden).toBe(true);
    press('KeyE');
    expect(root.querySelector('[aria-selected="true"]')!.textContent).toBe('Dźwięk');
    press('Escape');
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(pause.open).toBe(true);
    expect(root.querySelector<HTMLElement>('.dzo--pause')!.hidden).toBe(false);
  });

  it('Zapisz i wyjdź asks first, Esc cancels, Enter saves through the host', async () => {
    const { pause, root, saveAndExit } = setup();
    pause.openMenu();
    root.querySelector<HTMLElement>('.dzo-item--saveExit')!.click();
    expect(root.textContent).toContain('ZAPISAĆ I WYJŚĆ DO MENU?');
    press('Escape');
    expect(root.querySelector('.dzo-confirm')).toBeNull();
    expect(pause.open).toBe(true);
    expect(saveAndExit).not.toHaveBeenCalled();
    root.querySelector<HTMLElement>('.dzo-item--saveExit')!.click();
    press('Enter');
    await Promise.resolve();
    expect(saveAndExit).toHaveBeenCalledTimes(1);
  });

  it('a failed save keeps the session and shows the reason', async () => {
    const { pause, root, saveAndExit } = setup();
    saveAndExit.mockImplementation(() => Promise.reject(new Error('quota')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    pause.openMenu();
    root.querySelector<HTMLElement>('.dzo-item--saveExit')!.click();
    press('Enter');
    await new Promise((r) => setTimeout(r, 0));
    expect(pause.open).toBe(true);
    expect(root.textContent).toContain('Nie udało się zapisać świata');
  });
});
