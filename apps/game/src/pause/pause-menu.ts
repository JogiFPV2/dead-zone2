import type { AudioEngine } from '../audio/audio-engine.js';
import type { SettingsStore } from '../settings/store.js';
import { createConfirm, type ConfirmDialog } from '../menu/confirm-dialog.js';
import { icon } from '../menu/icons.js';
import { MINI_LOGO, keyBadge, mountOverlay } from '../menu/overlay-stage.js';
import { createSettingsScreen, type SettingsScreen } from '../menu/settings-screen.js';
import {
  PAUSE_ITEMS,
  SaveRefusedError,
  lastSaveLine,
  pauseKey,
  pauseSubtitle,
  stepPauseFocus,
  type PauseInfo,
  type PauseItemId,
  type WorldSaveMeta,
} from './pause-model.js';

export interface PauseMenuOptions {
  readonly root: HTMLElement;
  readonly settings: SettingsStore;
  readonly audio: Pick<AudioEngine, 'play' | 'preview'>;
  readonly trackTitle: string;
  /** Single-player: the sim is stopped while the menu is open (co-op: it keeps running). */
  readonly pausesSim: boolean;
  readonly info: PauseInfo;
  readonly lastSave: WorldSaveMeta | undefined;
  onResume(): void;
  /** Saves the world and leaves to the main menu; rejects when the save failed. */
  onSaveExit(): Promise<void>;
}

export interface PauseMenu {
  /** Routes a keydown; true when handled. */
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

/** Pause overlay (mockups pause-menu.png, pause-confirm.png); Ustawienia = the shared screen. */
export function createPauseMenu(o: PauseMenuOptions): PauseMenu {
  const overlay = mountOverlay(o.root, 'dzo--pause');
  const { el, stage } = overlay;
  let focus = 0;
  let settingsScreen: SettingsScreen | undefined;
  let confirm: ConfirmDialog | undefined;
  let saving = false;
  let error = '';
  let disposed = false;
  const ui = (id: 'ui-click1' | 'ui-rollover2'): void => o.audio.play('ui', id);

  function itemHtml(id: PauseItemId, i: number): string {
    const it = PAUSE_ITEMS.find((x) => x.id === id)!;
    const sel = i === focus;
    const save = id === 'saveExit';
    const sub = save
      ? `<span class="dzo-item-sub">${saving ? 'Zapisywanie…' : error || lastSaveLine(o.lastSave)}</span>`
      : '';
    const k = id === 'resume' ? keyBadge('ESC', sel) : keyBadge('ENTER', sel);
    return `<div class="dzo-item dzo-item--${id}${sel ? ' dzo-item--focus' : ''}${saving ? ' dzo-item--busy' : ''}" role="menuitem" data-i="${i}" tabindex="${sel ? 0 : -1}"${saving ? ' aria-disabled="true"' : ''}>${icon(it.icon, 21)}<span class="dzo-item-text"><span class="dzo-item-label">${it.label}</span>${sub}</span>${k}</div>`;
  }

  function render(): void {
    if (disposed) return;
    el.hidden = settingsScreen !== undefined;
    const keep = stage.querySelector('.dzo-confirm');
    const status = o.pausesSim
      ? 'Symulacja zatrzymana · AI i czas nie postępują'
      : 'Gra toczy się dalej · tryb wspólny';
    stage.innerHTML = `${MINI_LOGO}
<div class="dzo-paused">${icon('clock', 15)}<span>${o.pausesSim ? 'GRA WSTRZYMANA' : 'MENU'}</span>${keyBadge('ESC')}</div>
<div class="dzo-panel dzo-pause" role="dialog" aria-label="Pauza">
<div class="dzo-pause-head"><div><div class="dzo-pause-title">PAUZA</div><div class="dzo-pause-sub">${pauseSubtitle(o.info)}</div></div>${o.pausesSim ? '<span class="dzo-badge">PAUZA</span>' : ''}</div>
<div class="dzo-sep dzo-pause-sep1"></div>
<div class="dzo-items" role="menu" aria-label="Menu pauzy">${PAUSE_ITEMS.map((it, i) => itemHtml(it.id, i)).join('')}</div>
<div class="dzo-sep dzo-pause-sep2"></div>
<div class="dzo-pause-warn">${icon('warning', 15)}<span>Jedna postać = jeden zapis. Zapis zamknie bieżącą sesję.</span></div>
<div class="dzo-pause-status">${icon('pause', 13)}<span>${status}</span></div>
</div>
<div class="dzo-hints">${keyBadge('↑↓')}<span>wybierz</span>${keyBadge('ENTER')}<span>potwierdź</span>${keyBadge('ESC')}<span>wróć do gry</span></div>`;
    if (keep) stage.appendChild(keep);
    else if (!settingsScreen)
      stage.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }

  function askSaveExit(): void {
    confirm = createConfirm({
      host: stage,
      title: 'ZAPISAĆ I WYJŚĆ DO MENU?',
      body: 'Postęp zostanie zapisany, a bieżąca sesja zakończona.<br><span class="dzo-accent">Jedno życie. Jeden zapis świata.</span>',
      yes: 'ZAPISZ I WYJDŹ',
      focusYes: true,
      onAnswer(yes) {
        confirm = undefined;
        ui('ui-click1');
        if (yes) void saveExit();
        else render();
      },
    });
  }

  async function saveExit(): Promise<void> {
    saving = true;
    error = '';
    render();
    try {
      await o.onSaveExit();
    } catch (e) {
      // No partial exit: the session stays, the reason is shown inline.
      console.error('Zapis świata nie powiódł się', e);
      saving = false;
      error =
        e instanceof SaveRefusedError
          ? e.message
          : 'Nie udało się zapisać świata. Spróbuj ponownie.';
      render();
    }
  }

  function activate(id: PauseItemId): void {
    if (saving) return;
    ui('ui-click1');
    if (id === 'resume') o.onResume();
    else if (id === 'saveExit') askSaveExit();
    else {
      settingsScreen = createSettingsScreen({
        root: o.root,
        settings: o.settings,
        audio: o.audio,
        trackTitle: o.trackTitle,
        onClose() {
          settingsScreen = undefined;
          render();
        },
      });
      render();
    }
  }

  function onKey(e: KeyboardEvent): boolean {
    if (disposed) return false;
    if (settingsScreen) return settingsScreen.onKey(e);
    if (confirm) return confirm.onKey(e);
    const cmd = pauseKey(e.code, e.shiftKey);
    if (!cmd) return false;
    if (e.repeat && cmd.type !== 'move') return true;
    if (saving) return true;
    if (cmd.type === 'resume') {
      ui('ui-click1');
      o.onResume();
    } else if (cmd.type === 'activate') activate(PAUSE_ITEMS[focus]!.id);
    else {
      focus = stepPauseFocus(focus, cmd.delta);
      ui('ui-rollover2');
      render();
    }
    return true;
  }

  el.addEventListener('click', (e) => {
    if (confirm || saving) return;
    const item = (e.target as HTMLElement).closest<HTMLElement>('.dzo-item');
    if (item) activate(PAUSE_ITEMS[Number(item.dataset.i)]!.id);
  });
  el.addEventListener('pointerover', (e) => {
    if (confirm) return;
    const item = (e.target as HTMLElement).closest<HTMLElement>('.dzo-item');
    const i = item ? Number(item.dataset.i) : focus;
    if (i !== focus) {
      focus = i;
      render();
    }
  });
  render();

  return {
    onKey,
    dispose() {
      if (disposed) return;
      disposed = true;
      settingsScreen?.dispose();
      confirm?.dispose();
      overlay.dispose();
    },
  };
}
