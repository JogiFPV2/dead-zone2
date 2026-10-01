import type { AudioEngine } from '../audio/audio-engine.js';
import { DEFAULT_SETTINGS, type Settings } from '../settings/schema.js';
import type { SettingsStore } from '../settings/store.js';
import { createConfirm, type ConfirmDialog } from './confirm-dialog.js';
import { icon } from './icons.js';
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
  SETTINGS_TABS,
  isSettingsTab,
  settingsKey,
  stepSettingsFocus,
  stepTab,
  type SettingsFocus,
  type SettingsTab,
} from './settings-tabs.js';

export interface SettingsScreenOptions {
  readonly root: HTMLElement;
  readonly settings: SettingsStore;
  readonly audio: Pick<AudioEngine, 'play' | 'preview'>;
  readonly trackTitle: string;
  readonly initialTab?: SettingsTab;
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
  let tab: SettingsTab = o.initialTab ?? 'graphics';
  let draft: Settings = settings.get();
  let focus: SettingsFocus = { zone: 'tabs' };
  let confirm: ConfirmDialog | undefined;
  let disposed = false;
  let lastPreviewMs = 0;

  const ui = (id: 'ui-click1' | 'ui-rollover2' | 'ui-switch2'): void => audio.play('ui', id);
  const rows = (): SettingsRow[] =>
    settingsRows(tab, draft, {
      trackTitle: o.trackTitle,
      viewport: { width: window.innerWidth, height: window.innerHeight },
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
        return `<div class="${cls}"${attrs} role="slider" aria-label="${r.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><span class="dzo-row-label">${r.label}</span><span class="dzo-track" data-track="${r.id}"><i style="width:${p}%"></i><b style="left:${p}%"></b></span><span class="dzo-row-value">${p}</span><span class="dzo-row-note">${sel ? '◀ ▶ ±5 · Shift ±1' : r.note}</span></div>`;
      }
      case 'toggle':
        return `<div class="${cls}"${attrs} role="switch" aria-checked="${r.on}" aria-label="${r.label}"><span class="dzo-row-col"><span class="dzo-row-title">${r.label}</span><span class="dzo-row-hint">${r.hint}</span></span><span class="dzo-toggle${r.on ? ' dzo-toggle--on' : ''}"></span></div>`;
      case 'choice': {
        const opts = r.options
          .map((op) => {
            const on = op.id === r.value;
            return `<button type="button" class="dzo-opt${on ? ' dzo-opt--on' : ''}" data-opt="${op.id}" aria-pressed="${on}" tabindex="-1"><span>${op.label}</span><em>${on ? 'AKTYWNY' : '—'}</em></button>`;
          })
          .join('');
        return `<div class="${cls}"${attrs} role="radiogroup" aria-label="${r.label}"><span class="dzo-row-col"><span class="dzo-row-title">${r.label}</span><span class="dzo-row-hint">${r.hint}</span></span><span class="dzo-opts">${opts}</span></div>`;
      }
      case 'info':
        return `<div class="${cls}"><span class="dzo-row-title">${r.label}</span><span class="dzo-row-info">${r.soon ? `<span class="dzo-soon">${r.value}</span>` : r.value}</span></div>`;
    }
  }

  function render(): void {
    if (disposed) return;
    const tabs = SETTINGS_TABS.map((t) => {
      const on = t.id === tab;
      const tf = on && focus.zone === 'tabs';
      return `<button type="button" class="dzo-tab${on ? ' dzo-tab--on' : ''}${tf ? ' dzo-tab--focus' : ''}" role="tab" id="dzo-tab-${t.id}" data-tab="${t.id}" aria-selected="${on}" aria-controls="dzo-tabpanel" tabindex="${tf ? 0 : -1}">${t.label}</button>`;
    }).join('');
    let fi = 0;
    const body = rows()
      .map((r) => renderRow(r, isFocusable(r) ? fi++ : undefined))
      .join('');
    // The confirm dialog (if any) lives in the stage too: keep it on top.
    const keep = stage.querySelector('.dzo-confirm');
    stage.innerHTML = `${MINI_LOGO}
<div class="dzo-panel dzo-settings" role="dialog" aria-label="Ustawienia">
<div class="dzo-settings-head"><span class="dzo-title">USTAWIENIA</span><span class="dzo-grow"></span><div class="dzo-tabs" role="tablist" aria-label="Kategorie ustawień">${tabs}</div></div>
<div class="dzo-sep"></div>
<div class="dzo-settings-body" id="dzo-tabpanel" role="tabpanel" aria-labelledby="dzo-tab-${tab}" data-panel="${tab}">${body}</div>
<div class="dzo-settings-foot"><button type="button" class="dzo-btn dzo-btn--sec" data-act="defaults">${icon('reset', 16)} PRZYWRÓĆ DOMYŚLNE</button><span class="dzo-grow"></span><button type="button" class="dzo-btn dzo-btn--sec" data-act="back">WSTECZ ${keyBadge('ESC')}</button><button type="button" class="dzo-btn dzo-btn--pri" data-act="apply">ZASTOSUJ ${keyBadge('ENTER', true)}</button></div>
</div>
<div class="dzo-hints">${keyBadge('Q / E')}<span>zmień zakładkę</span>${keyBadge('↑↓')}<span>wybierz</span>${keyBadge('ESC')}<span>wstecz</span></div>`;
    if (keep) stage.appendChild(keep);
    else stage.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
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
    }
    api.dispose();
    o.onClose();
  }

  function back(): void {
    if (!isDirty(draft, settings.get())) {
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

  function focusedRow(): FocusableRow | undefined {
    return focus.zone === 'row' ? focusable()[focus.index] : undefined;
  }

  function onKey(e: KeyboardEvent): boolean {
    if (disposed) return false;
    if (confirm) return confirm.onKey(e);
    const cmd = settingsKey(e.code, { ctrl: e.ctrlKey, shift: e.shiftKey }, focus);
    if (!cmd) return false;
    if (e.repeat && (cmd.type === 'apply' || cmd.type === 'back' || cmd.type === 'tab'))
      return true;
    const row = focusedRow();
    switch (cmd.type) {
      case 'tab':
        setTab(stepTab(tab, cmd.delta));
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
        if (row) {
          ui('ui-switch2');
          setDraft(activateRow(draft, row));
        } else if (focus.zone === 'tabs' && focusable().length) {
          focus = { zone: 'row', index: 0 };
          render();
        }
        break;
      case 'apply':
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
    if (isSettingsTab(tabId)) {
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

  function onOver(e: PointerEvent): void {
    if (confirm || dragKey) return;
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (!rowEl) return;
    const index = Number(rowEl.dataset.row);
    if (focus.zone === 'row' && focus.index === index) return;
    focus = { zone: 'row', index };
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
      audio.preview(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      overlay.dispose();
    },
  };
  return api;
}
