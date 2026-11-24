import type { AudioEngine } from '../audio/audio-engine.js';
import { HUD_LAYOUT_VERSION, type HudLayout } from '@deadzone/ui/settings';
import { DEFAULT_SETTINGS, type Settings } from '../settings/schema.js';
import type { PlayerSettingsStore } from '../settings/player-settings-store.js';
import { layoutPreviewHtml } from '../hud/layout/layout-preview.js';
import { noisePreview } from './noise-preview.js';
import type { SettingsStore } from '../settings/store.js';
import { createConfirm, type ConfirmDialog } from './confirm-dialog.js';
import { icon } from './icons.js';
import { setUiScale } from '../ui/ui-scale.js';
import { sliderAt } from './menu-model.js';
import { MINI_LOGO, keyBadge, mountOverlay } from './overlay-stage.js';
import {
  activateRow,
  adjustRow,
  chooseRow,
  isDirty,
  isFocusable,
  setSlider,
  settingsRows,
  sliderPercent,
  type FocusableRow,
  type SettingsRow,
} from './settings-rows.js';
import {
  isSettingsTab,
  settingsKey,
  settingsTabs,
  stepSettingsFocus,
  stepTab,
  type SettingsFocus,
  type SettingsTab,
} from './settings-tabs.js';
import type { AccountSession } from '../account/account-session.js';
import { createAccountPanel, type AccountPanel } from './account-panel.js';

/** Settings being edited plus the HUD layout (back and forth with the HUD editor). */
export interface SettingsDraft {
  readonly settings: Settings;
  readonly hud: HudLayout;
}

const EMPTY_HUD: HudLayout = { version: HUD_LAYOUT_VERSION, elements: {} };

export interface SettingsScreenOptions {
  readonly root: HTMLElement;
  readonly settings: SettingsStore;
  readonly audio: Pick<AudioEngine, 'play' | 'preview'>;
  readonly trackTitle: string;
  readonly initialTab?: SettingsTab;
  /** Draft to continue with (back from the HUD editor); default: the stored settings. */
  readonly initialDraft?: SettingsDraft;
  /** Whole settings object: the HUD layout (`hud`) is read and saved through it. */
  readonly player?: Pick<PlayerSettingsStore, 'load' | 'save'>;
  /**
   * „Edytuj HUD” (Interfejs): the owner closes this screen and opens the editor with the draft.
   * Missing (main menu): the row is disabled.
   */
  readonly onEditHud?: (draft: SettingsDraft) => void;
  /** Online accounts: adds Ustawienia › Konto (account-settings.png). */
  readonly account?: AccountSession | undefined;
  /** Konto › ZALOGUJ SIĘ (main menu only): the screen is already disposed. */
  readonly onLogin?: (() => void) | undefined;
  /** Konto › account deleted / logged out: the screen is already disposed. */
  readonly onAccountGone?: (() => void) | undefined;
  /** Back / Zastosuj: the screen is already disposed. */
  onClose(): void;
}

export interface SettingsScreen {
  readonly tab: SettingsTab;
  /** Routes a keydown (the owner listens); true when handled. */
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

/**
 * Ustawienia (mockup pause-settings-graphics.png), shared by the main menu and the pause menu.
 * Tabs switch by click, Q/E, Ctrl+Tab (Shift = back) and ←/→ on the tab strip. Edits go to a
 * draft (audio previewed live) and are saved on Zastosuj; Wstecz with changes asks first.
 */
export function createSettingsScreen(o: SettingsScreenOptions): SettingsScreen {
  const { settings, audio } = o;
  const overlay = mountOverlay(o.root, 'dzo--settings');
  const { stage } = overlay;
  const tabList = settingsTabs(!!o.account?.online);
  let tab: SettingsTab =
    o.initialTab && isSettingsTab(o.initialTab, tabList) ? o.initialTab : 'graphics';
  let accountPanel: AccountPanel | undefined;
  function panel(): AccountPanel | undefined {
    if (!o.account) return undefined;
    accountPanel ??= createAccountPanel({
      account: o.account,
      onLogin: o.onLogin
        ? () => {
            api.dispose();
            o.onLogin?.();
          }
        : undefined,
      onDeleted: () => {
        api.dispose();
        (o.onAccountGone ?? o.onClose)();
      },
    });
    return accountPanel;
  }
  let draft: Settings = o.initialDraft?.settings ?? settings.get();
  const storedHud = (): HudLayout => o.player?.load().hud ?? EMPTY_HUD;
  let hudDraft: HudLayout = o.initialDraft?.hud ?? storedHud();
  let focus: SettingsFocus = { zone: 'tabs' };
  let confirm: ConfirmDialog | undefined;
  let disposed = false;
  let lastPreviewMs = 0;

  const ui = (id: 'ui-click1' | 'ui-rollover2' | 'ui-switch2'): void => audio.play('ui', id);
  const rows = (): SettingsRow[] =>
    settingsRows(tab, draft, {
      trackTitle: o.trackTitle,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      hudEditor: o.onEditHud !== undefined,
      hudLayout: hudDraft,
    });
  const focusable = (): FocusableRow[] => rows().filter(isFocusable);

  function renderRow(r: SettingsRow, fi: number | undefined): string {
    const sel = fi !== undefined && focus.zone === 'row' && focus.index === fi;
    const cls = `dzo-row dzo-row--${r.kind}${sel ? ' dzo-row--focus' : ''}`;
    const attrs = fi === undefined ? '' : ` data-row="${fi}" tabindex="${sel ? 0 : -1}"`;
    switch (r.kind) {
      case 'header':
        return `<div class="dzo-hdr"><span>${r.label}</span>${r.note ? `<em>${r.note}</em>` : ''}</div>`;
      case 'slider': {
        const p = sliderPercent(r.value);
        const shown = r.display ?? String(p);
        return `<div class="${cls}"${attrs} role="slider" aria-label="${r.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}" aria-valuetext="${shown}">${r.hint ? `<span class="dzo-row-col dzo-row-label"><span class="dzo-row-title">${r.label}</span><span class="dzo-row-hint">${r.hint}</span></span>` : `<span class="dzo-row-label">${r.label}</span>`}<span class="dzo-track" data-track="${r.id}"><i style="width:${p}%"></i><b style="left:${p}%"></b></span><span class="dzo-row-value">${shown}</span><span class="dzo-row-note">${sel ? (r.keys ?? '◀ ▶ ±5 · Shift ±1') : r.note}</span></div>`;
      }
      case 'toggle':
        return `<div class="${cls}"${attrs} role="switch" aria-checked="${r.on}" aria-label="${r.label}"><span class="dzo-row-col"><span class="dzo-row-title">${r.label}</span><span class="dzo-row-hint">${r.hint}</span></span><span class="dzo-toggle${r.on ? ' dzo-toggle--on' : ''}"></span></div>`;
      case 'choice': {
        const opts = r.options
          .map((op) => {
            const on = op.id === r.value;
            return `<button type="button" class="dzo-opt${on ? ' dzo-opt--on' : ''}" data-opt="${op.id}" aria-pressed="${on}" tabindex="-1"><span>${op.label}</span><em>${on ? (r.activeLabel ?? 'AKTYWNY') : '—'}</em></button>`;
          })
          .join('');
        if (r.card) {
          const legend = r.card.legend
            .map(
              (l) =>
                `<span class="dzo-legend-k${l.id === r.value ? ' dzo-legend--on' : ''}">${l.label}</span><span class="dzo-legend-v${l.id === r.value ? ' dzo-legend--on' : ''}">${l.text}</span>`,
            )
            .join('');
          return `<div class="${cls} dzo-row--card"${attrs} role="radiogroup" aria-label="${r.label}"><div class="dzo-card-top"><span class="dzo-row-col"><span class="dzo-row-title">${r.label}</span><span class="dzo-row-hint">${r.hint}</span></span><span class="dzo-opts dzo-opts--card">${opts}</span></div><div class="dzo-legend">${legend}</div></div><div class="dzo-warn">${icon('warning', 15)}<span>${r.card.warn}</span></div>`;
        }
        return `<div class="${cls}"${attrs} role="radiogroup" aria-label="${r.label}"><span class="dzo-row-col"><span class="dzo-row-title">${r.label}</span><span class="dzo-row-hint">${r.hint}</span></span><span class="dzo-opts">${opts}</span></div>`;
      }
      case 'info':
        return `<div class="${cls}"><span class="dzo-row-title">${r.label}</span><span class="dzo-row-info">${r.soon ? `<span class="dzo-soon">${r.value}</span>` : r.value}</span></div>`;
      case 'button':
        return `<div class="${cls}${r.accent ? ' dzo-row--accent' : ''}"${attrs} aria-label="${r.label}"><span class="dzo-row-col"><span class="dzo-row-title">${r.label}</span><span class="dzo-row-hint">${r.hint}</span>${r.state ? `<span class="dzo-row-hint dzo-row-state">${r.state}</span>` : ''}</span><button type="button" class="dzo-btn ${r.accent ? 'dzo-btn--pri' : 'dzo-btn--sec'} dzo-row-btn" data-btn="${r.id}"${r.disabled ? ' disabled aria-disabled="true"' : ''} tabindex="-1">${icon(r.icon, 15)} ${r.button}</button></div>`;
    }
  }

  function render(): void {
    if (disposed) return;
    const tabs = tabList
      .map((t) => {
        const on = t.id === tab;
        const tf = on && focus.zone === 'tabs';
        return `<button type="button" class="dzo-tab${on ? ' dzo-tab--on' : ''}${tf ? ' dzo-tab--focus' : ''}" role="tab" id="dzo-tab-${t.id}" data-tab="${t.id}" aria-selected="${on}" aria-controls="dzo-tabpanel" tabindex="${tf ? 0 : -1}">${t.label}</button>`;
      })
      .join('');
    let fi = 0;
    const list = rows()
      .map((r) => renderRow(r, isFocusable(r) ? fi++ : undefined))
      .join('');
    const body =
      tab === 'interface'
        ? `<div class="dzo-cols"><div class="dzo-col">${list}</div><div class="dzo-col dzo-col--side">${focusedRow()?.id === 'noiseDisplay' ? noisePreview(draft.interface.noiseDisplay) : layoutPreviewHtml(hudDraft, draft.interface.osmMap)}</div></div>`
        : tab === 'account'
          ? '<div data-account-slot></div>'
          : list;
    const accountTab = tab === 'account';
    // Every render rebuilds the panel: keep the list's scroll (hovering a row re-renders, and the
    // long Interfejs tab used to jump back to the top while scrolling).
    const oldBody = stage.querySelector<HTMLElement>('.dzo-settings-body');
    const keepScroll = oldBody?.dataset.panel === tab ? oldBody.scrollTop : 0;
    // The confirm dialog (if any) lives in the stage too: keep it on top.
    const keep = stage.querySelector('.dzo-confirm');
    stage.innerHTML = `${MINI_LOGO}
<div class="dzo-panel dzo-settings" role="dialog" aria-label="Ustawienia">
<div class="dzo-settings-head"><span class="dzo-title">USTAWIENIA</span><span class="dzo-grow"></span><div class="dzo-tabs" role="tablist" aria-label="Kategorie ustawień">${tabs}</div></div>
<div class="dzo-sep"></div>
<div class="dzo-settings-body" id="dzo-tabpanel" role="tabpanel" aria-labelledby="dzo-tab-${tab}" data-panel="${tab}">${body}</div>
${accountTab ? '' : `<div class="dzo-settings-foot"><button type="button" class="dzo-btn dzo-btn--sec" data-act="defaults">${icon('reset', 16)} PRZYWRÓĆ DOMYŚLNE</button><span class="dzo-grow"></span><button type="button" class="dzo-btn dzo-btn--sec" data-act="back">WSTECZ ${keyBadge('ESC')}</button><button type="button" class="dzo-btn dzo-btn--pri" data-act="apply">ZASTOSUJ ${keyBadge('ENTER', true)}</button></div>`}
</div>
<div class="dzo-hints">${keyBadge('Q / E')}<span>zmień zakładkę</span>${keyBadge('↑↓')}<span>wybierz</span>${editFocused() ? `${keyBadge('ENTER')}<span>edytuj HUD</span>` : `${keyBadge('ESC')}<span>wstecz</span>`}</div>`;
    if (accountTab) {
      const p = panel();
      const slot = stage.querySelector('[data-account-slot]');
      if (p && slot) slot.replaceWith(p.el);
    }
    const newBody = stage.querySelector<HTMLElement>('.dzo-settings-body');
    if (newBody) newBody.scrollTop = keepScroll;
    if (keep) stage.appendChild(keep);
    else {
      const f = stage.querySelector<HTMLElement>('[tabindex="0"]');
      f?.focus({ preventScroll: true });
      // ↑/↓ past the visible part of the list: bring the focused row into view.
      if (f?.dataset.row !== undefined && !scrollFromPointer)
        f.scrollIntoView?.({ block: 'nearest' });
    }
    scrollFromPointer = false;
  }

  /** Konto: ↑/↓ walk the panel's controls (it has no settings rows). */
  function moveAccountFocus(delta: 1 | -1): void {
    const items = [
      stage.querySelector<HTMLElement>('.dzo-tab--on'),
      ...stage.querySelectorAll<HTMLElement>(
        '.dza-set-wrap button:not([disabled]), .dza-set-wrap input:not([disabled])',
      ),
    ].filter((x): x is HTMLElement => !!x);
    const cur = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(((cur + delta) % items.length) + items.length) % items.length];
    next?.focus({ preventScroll: true });
  }

  function setTab(next: SettingsTab): void {
    if (next === tab) return;
    tab = next;
    if (focus.zone === 'row')
      focus = focusable().length ? { zone: 'row', index: 0 } : { zone: 'tabs' };
    ui('ui-switch2');
    render();
  }

  function setDraft(next: Settings, previewKey?: string): void {
    const audioChanged = next.audio !== draft.audio;
    draft = next;
    if (audioChanged) audio.preview(draft.audio);
    // Skala interfejsu previews live (this screen too); Wstecz restores the saved one.
    setUiScale(draft.graphics.uiScale);
    const now = performance.now();
    if (previewKey && now - lastPreviewMs > 90) {
      lastPreviewMs = now;
      if (previewKey === 'effects') audio.play('sfx', 'ui-switch2');
      else if (previewKey === 'voice' || previewKey === 'master') audio.play('ui', 'ui-click1');
    }
    render();
  }

  function close(save: boolean): void {
    if (save) {
      const d = draft;
      settings.update((s) => ({
        ...s,
        audio: d.audio,
        graphics: d.graphics,
        interface: d.interface,
      }));
      // The layout lives in PlayerSettings next to `Settings` (player-settings-store.ts).
      if (o.player && hudDirty()) {
        const r = o.player.save({ ...o.player.load(), hud: hudDraft });
        if (!r.ok) console.warn('Układ HUD nie został zapisany', r);
      }
    }
    api.dispose();
    o.onClose();
  }

  function back(): void {
    if (!isDirty(draft, settings.get()) && !hudDirty()) {
      ui('ui-click1');
      close(false);
      return;
    }
    confirm = createConfirm({
      host: stage,
      title: 'ODRZUCIĆ ZMIANY?',
      body: 'Niezapisane zmiany ustawień zostaną utracone.',
      yes: 'ODRZUĆ',
      onAnswer(yes) {
        confirm = undefined;
        ui('ui-click1');
        if (yes) close(false);
        else render();
      },
    });
  }

  /** Button rows: Edytuj HUD hands the draft over, Przywróć domyślny układ asks first. */
  function runButton(id: 'editHud' | 'resetHud'): void {
    const row = focusable().find((r) => r.kind === 'button' && r.id === id);
    if (row?.kind !== 'button' || row.disabled) return;
    ui('ui-click1');
    if (id === 'editHud') {
      const d: SettingsDraft = { settings: draft, hud: hudDraft };
      api.dispose();
      o.onEditHud?.(d);
      return;
    }
    confirm = createConfirm({
      host: stage,
      title: 'PRZYWRÓCIĆ DOMYŚLNY UKŁAD HUD?',
      body: 'Wszystkie elementy wrócą na swoje miejsca. Skala interfejsu zostaje.',
      yes: 'PRZYWRÓĆ',
      onAnswer(yes) {
        confirm = undefined;
        ui('ui-click1');
        if (yes) hudDraft = EMPTY_HUD;
        render();
      },
    });
  }

  function hudDirty(): boolean {
    return JSON.stringify(hudDraft) !== JSON.stringify(storedHud());
  }

  function editFocused(): boolean {
    const r = focusedRow();
    return r?.kind === 'button' && r.id === 'editHud' && !r.disabled;
  }

  function focusedRow(): FocusableRow | undefined {
    return focus.zone === 'row' ? focusable()[focus.index] : undefined;
  }

  function onKey(e: KeyboardEvent): boolean {
    if (disposed) return false;
    if (confirm) return confirm.onKey(e);
    // Text fields (Konto › e-mail) keep their keys; Esc still goes back.
    if (e.target instanceof HTMLInputElement && e.code !== 'Escape') return false;
    if (tab === 'account') {
      if (e.code === 'Tab' && !e.ctrlKey) return false;
      if ((e.code === 'Enter' || e.code === 'Space') && e.target instanceof HTMLButtonElement) {
        return false;
      }
    }
    const cmd = settingsKey(e.code, { ctrl: e.ctrlKey, shift: e.shiftKey }, focus);
    if (!cmd) return false;
    if (tab === 'account' && cmd.type === 'focus') {
      moveAccountFocus(cmd.delta);
      return true;
    }
    if (tab === 'account' && cmd.type === 'apply') return true;
    if (e.repeat && (cmd.type === 'apply' || cmd.type === 'back' || cmd.type === 'tab'))
      return true;
    const row = focusedRow();
    switch (cmd.type) {
      case 'tab':
        setTab(stepTab(tab, cmd.delta, tabList));
        break;
      case 'focus':
        focus = stepSettingsFocus(focus, cmd.delta, focusable().length);
        ui('ui-rollover2');
        render();
        break;
      case 'adjust':
        if (row) {
          setDraft(
            adjustRow(draft, row, cmd.dir < 0 ? 'ArrowLeft' : 'ArrowRight', cmd.fine),
            row.kind === 'slider' ? row.id : undefined,
          );
          if (row.kind !== 'slider') ui('ui-switch2');
        }
        break;
      case 'jump':
        if (row) setDraft(adjustRow(draft, row, cmd.to === 0 ? 'Home' : 'End', false));
        break;
      case 'activate':
        if (row?.kind === 'button') runButton(row.id);
        else if (row) {
          ui('ui-switch2');
          setDraft(activateRow(draft, row));
        } else if (focus.zone === 'tabs' && focusable().length) {
          focus = { zone: 'row', index: 0 };
          render();
        }
        break;
      case 'apply':
        // Enter on „Układ HUD” opens the editor (settings-hud.png hint row); elsewhere Zastosuj.
        if (row?.kind === 'button' && row.id === 'editHud' && !row.disabled) {
          runButton('editHud');
          break;
        }
        ui('ui-click1');
        close(true);
        break;
      case 'back':
        back();
        break;
    }
    return true;
  }

  function onClick(e: MouseEvent): void {
    if (confirm) return;
    const t = e.target as HTMLElement;
    const tabId = t.closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (isSettingsTab(tabId, tabList)) {
      focus = { zone: 'tabs' };
      if (tabId === tab) render();
      else setTab(tabId);
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'apply') {
      ui('ui-click1');
      close(true);
      return;
    }
    if (act === 'back') return back();
    if (act === 'defaults') {
      ui('ui-click1');
      const d = DEFAULT_SETTINGS;
      setDraft({
        ...draft,
        audio: { ...d.audio, muted: draft.audio.muted },
        graphics: d.graphics,
        interface: d.interface,
      });
      return;
    }
    const btn = t.closest<HTMLElement>('[data-btn]')?.dataset.btn;
    if (btn === 'editHud' || btn === 'resetHud') {
      runButton(btn);
      return;
    }
    const rowEl = t.closest<HTMLElement>('[data-row]');
    if (!rowEl) return;
    const index = Number(rowEl.dataset.row);
    const row = focusable()[index];
    if (!row) return;
    focus = { zone: 'row', index };
    const opt = t.closest<HTMLElement>('[data-opt]')?.dataset.opt;
    if (row.kind === 'choice' && opt) {
      ui('ui-switch2');
      setDraft(chooseRow(draft, row.id, opt));
    } else if (row.kind === 'toggle') {
      ui('ui-switch2');
      setDraft(activateRow(draft, row));
    } else render();
  }

  /** The next render comes from the mouse: the row is under the pointer, so no scrolling. */
  let scrollFromPointer = false;
  function onOver(e: PointerEvent): void {
    if (confirm || dragKey) return;
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (!rowEl) return;
    const index = Number(rowEl.dataset.row);
    if (focus.zone === 'row' && focus.index === index) return;
    focus = { zone: 'row', index };
    scrollFromPointer = true;
    render();
  }

  let dragKey: string | undefined;
  function dragTo(e: PointerEvent): void {
    if (!dragKey) return;
    const track = stage.querySelector<HTMLElement>(`[data-track="${dragKey}"]`);
    const row = focusable().find((r) => r.kind === 'slider' && r.id === dragKey);
    if (!track || row?.kind !== 'slider') return;
    const b = track.getBoundingClientRect();
    const v = sliderAt(e.clientX, b.left, b.width);
    if (v !== row.value) setDraft(setSlider(draft, row.id, v), row.id);
  }
  function onDown(e: PointerEvent): void {
    const track = (e.target as HTMLElement).closest<HTMLElement>('[data-track]');
    if (!track || e.button !== 0 || confirm) return;
    dragKey = track.dataset.track;
    const index = focusable().findIndex((r) => r.kind === 'slider' && r.id === dragKey);
    if (index >= 0) focus = { zone: 'row', index };
    dragTo(e);
    e.preventDefault();
  }
  const onMove = (e: PointerEvent): void => dragTo(e);
  const onUp = (): void => {
    dragKey = undefined;
  };

  overlay.el.addEventListener('click', onClick);
  overlay.el.addEventListener('pointerover', onOver);
  overlay.el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  render();

  const api: SettingsScreen = {
    get tab() {
      return tab;
    },
    onKey,
    dispose() {
      if (disposed) return;
      disposed = true;
      confirm?.dispose();
      accountPanel?.dispose();
      audio.preview(null);
      // Saved on Zastosuj (the store applies it), otherwise back to the stored scale.
      setUiScale(settings.get().graphics.uiScale);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      overlay.dispose();
    },
  };
  return api;
}
