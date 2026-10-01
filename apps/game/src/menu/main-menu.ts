import '@deadzone/ui/hud.css';
import './main-menu.css';
import type { AudioEngine } from '../audio/audio-engine.js';
import { percent } from '../audio/mix.js';
import { DEFAULT_SETTINGS, type AudioSettings } from '../settings/schema.js';
import type { SettingsStore } from '../settings/store.js';
import { WORDMARK, icon } from './icons.js';
import { firstEnabled, menuScale, sliderAt, sliderKey, stepFocus } from './menu-model.js';

export type GameMode = 'survive' | 'rescue';

export interface MainMenuOptions {
  readonly root: HTMLElement;
  readonly settings: SettingsStore;
  readonly audio: AudioEngine;
  /** „Dzień 4 · Riverside · 2 godz. temu”; undefined = no save → „Kontynuuj” hidden. */
  readonly continueInfo?: string;
  readonly version: string;
  readonly track: { readonly title: string; readonly credit: string };
  /** Background blur for sub-screens. */
  setDimmed(dim: boolean): void;
  onStart(choice: { mode: GameMode; resume: boolean }): void;
}

export interface MainMenu {
  dispose(): void;
}

type View = 'main' | 'settings' | 'credits';
type ItemId = 'continue' | 'new' | 'modes' | 'load' | 'settings' | 'credits' | 'quit';

interface Item {
  id: ItemId;
  icon: string;
  label: string;
  sub?: string;
  disabled?: boolean;
}

const VOLUMES: readonly {
  key: keyof Pick<AudioSettings, 'master' | 'music' | 'effects' | 'ambience' | 'voice'>;
  label: string;
  note: string;
}[] = [
  { key: 'master', label: 'Główna', note: '' },
  { key: 'music', label: 'Muzyka', note: '' },
  { key: 'effects', label: 'Efekty', note: 'broń, kroki, zombie' },
  { key: 'ambience', label: 'Otoczenie', note: 'wiatr, deszcz, miasto' },
  { key: 'voice', label: 'Głosy/UI', note: 'dialogi, kliknięcia' },
];
const TABS = ['Grafika', 'Audio', 'Sterowanie', 'Interfejs', 'Rozgrywka', 'Dostępność'];
const MODES: readonly { id: GameMode; label: string }[] = [
  { id: 'survive', label: 'Przetrwaj' },
  { id: 'rescue', label: 'Ratunek' },
];

/** Assets shown in „Autorzy” (all CC0 / OFL, details in ASSETS.md). */
const CREDITS: readonly [string, string][] = [
  ['Postacie i zombie', 'Quaternius · CC0'],
  ['Meble, przedmioty, otoczenie', 'Kenney, Quaternius, Pichuliru · CC0'],
  ['Muzyka „EmptyCity”', 'yd · OpenGameArt · CC0'],
  ['Otoczenie „Crickets Ambient Noise”', 'Wolfgang_ · OpenGameArt · CC0'],
  ['Dźwięki interfejsu „UI Audio”', 'Kenney · CC0'],
  ['Fonty Inter, JetBrains Mono', 'SIL Open Font License 1.1'],
];

const key = (k: string): string => `<span class="dzm-key">${k}</span>`;
const eq = '<span class="dzm-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

/**
 * Main menu DOM (deadzone-menu-spec §2–§5): one shared focus for mouse and keyboard, roving
 * tabindex, Settings › Audio with live preview. Keys are captured while the menu is shown.
 */
export function createMainMenu(o: MainMenuOptions): MainMenu {
  const { settings, audio } = o;
  const el = document.createElement('div');
  el.className = 'dzm';
  el.innerHTML = `<div class="dzm-shade" aria-hidden="true"></div><div class="dzm-stage"></div>`;
  o.root.appendChild(el);
  const stage = el.querySelector<HTMLElement>('.dzm-stage')!;

  const items: Item[] = [
    ...(o.continueInfo
      ? [{ id: 'continue' as const, icon: 'play', label: 'Kontynuuj', sub: o.continueInfo }]
      : []),
    { id: 'new', icon: 'plus', label: 'Nowa gra' },
    { id: 'modes', icon: 'layers', label: 'Tryby' },
    { id: 'load', icon: 'folder', label: 'Wczytaj', sub: 'Wkrótce', disabled: true },
    { id: 'settings', icon: 'gear', label: 'Ustawienia' },
    { id: 'credits', icon: 'users', label: 'Autorzy' },
    { id: 'quit', icon: 'exit', label: 'Wyjdź' },
  ];
  let view: View = 'main';
  let focus = firstEnabled(items);
  let mode: GameMode = 'survive';
  let confirm: { text: string; yes: string; onYes: () => void; focusYes: boolean } | undefined;
  let note = '';
  // Settings › Audio draft (applied live via audio.preview, saved on Zastosuj).
  let draft: AudioSettings = settings.get().audio;
  let row = 0;
  let lastPreviewMs = 0;

  const ui = (id: 'ui-click1' | 'ui-rollover2' | 'ui-switch2'): void => audio.play('ui', id);
  const dirty = (): boolean => JSON.stringify(draft) !== JSON.stringify(settings.get().audio);
  const musicOn = (): boolean => settings.get().audio.menuMusic;

  function audioChips(withToggle: boolean): string {
    const on = musicOn();
    const playing = `<div class="dzm-chip dzm-now${on ? '' : ' dzm-now--off'}">${eq}<span>Teraz gra: <b>${o.track.title}</b> <em>· ${o.track.credit}</em></span></div>`;
    if (!withToggle) return `<div class="dzm-audio">${playing}</div>`;
    return `<div class="dzm-audio">${playing}<button type="button" class="dzm-chip dzm-music${on ? ' dzm-music--on' : ''}" data-act="music" aria-pressed="${on}">${icon(on ? 'music' : 'musicOff', 16)}<span>MUZYKA: ${on ? 'WŁ.' : 'WYŁ.'}</span>${key('M')}</button></div>`;
  }

  function renderMain(): string {
    const list = items
      .map((it, i) => {
        const sel = i === focus;
        const chips =
          it.id === 'modes'
            ? `<span class="dzm-modes">${MODES.map((m) => `<span class="dzm-mode${m.id === mode ? ' dzm-mode--on' : ''}" data-mode="${m.id}">${m.label}</span>`).join('')}</span>`
            : '';
        const sep = it.id === 'quit' ? '<div class="dzm-sep" role="separator"></div>' : '';
        return `${sep}<div class="dzm-item${sel ? ' dzm-item--focus' : ''}${it.sub ? ' dzm-item--sub' : ''}" role="menuitem" data-i="${i}" tabindex="${sel ? 0 : -1}"${it.disabled ? ' aria-disabled="true"' : ''}>${icon(it.icon, 20)}<span class="dzm-item-text"><span class="dzm-item-label">${it.label}</span>${it.sub ? `<span class="dzm-item-sub">${it.sub}</span>` : ''}</span>${chips}${sel ? `<span class="dzm-item-enter">${key('Enter')}</span>` : ''}</div>`;
      })
      .join('');
    return `<div class="dzm-logo">${WORDMARK}<div class="dzm-tag"><i></i><span>PRZETRWAJ. NIC WIĘCEJ.</span></div></div>
<div class="dzm-list" role="menu" aria-label="Menu główne">${list}</div>
<div class="dzm-hints">${note ? `<span class="dzm-note">${note}</span>` : `<span>${key('↑↓')} wybierz</span><span>${key('Enter')} potwierdź</span><span>${key('Esc')} wstecz</span>`}</div>
<div class="dzm-version">${o.version}</div>
<div class="dzm-account">${icon('user', 14)}<span><b>Graj offline</b> <em>· zaloguj później</em></span></div>
${audioChips(true)}`;
  }

  function renderSettings(): string {
    const sliders = VOLUMES.map((v, i) => {
      const p = percent(draft[v.key]);
      return `<div class="dzm-row${row === i ? ' dzm-row--focus' : ''}" data-row="${i}" role="slider" tabindex="${row === i ? 0 : -1}" aria-label="${v.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><span class="dzm-row-label">${v.label}</span><span class="dzm-track" data-track="${v.key}"><i style="width:${p}%"></i><b style="left:${p}%"></b></span><span class="dzm-row-value">${p}</span><span class="dzm-row-note">${row === i ? '◀ ▶ ±5 · Shift ±1' : v.note}</span></div>`;
    }).join('');
    const mm = VOLUMES.length;
    const tabs = TABS.map(
      (t) =>
        `<span class="dzm-tab${t === 'Audio' ? ' dzm-tab--on' : ''}"${t === 'Audio' ? '' : ' aria-disabled="true" title="Wkrótce"'}>${t}</span>`,
    ).join('');
    return `<div class="dzm-logo dzm-logo--small">${WORDMARK}<div class="dzm-tag"><i></i><span>PRZETRWAJ. NIC WIĘCEJ.</span></div></div>
<div class="dzm-panel" role="dialog" aria-label="Ustawienia">
<div class="dzm-panel-head"><span class="dzm-panel-title">USTAWIENIA</span><span class="dzm-tabs">${tabs}</span></div>
<div class="dzm-hsep"></div>
<div class="dzm-hdr"><span>GŁOŚNOŚĆ</span><em>zmiany słychać od razu</em></div>
<div>${sliders}</div>
<div class="dzm-hdr"><span>MUZYKA</span></div>
<div class="dzm-row dzm-row--toggle${row === mm ? ' dzm-row--focus' : ''}" data-row="${mm}" role="switch" tabindex="${row === mm ? 0 : -1}" aria-checked="${draft.menuMusic}"><span class="dzm-row-col"><span class="dzm-row-title">Muzyka w menu</span><span class="dzm-row-hint">Ścieżka gry (CC0) w menu głównym · teraz: „${o.track.title}”</span></span><span class="dzm-toggle${draft.menuMusic ? ' dzm-toggle--on' : ''}"></span></div>
<div class="dzm-row dzm-row--toggle dzm-row--disabled" aria-disabled="true"><span class="dzm-row-col"><span class="dzm-row-title">${icon('yt', 18)} Własna muzyka (YouTube) <span class="dzm-soon">Wkrótce</span></span><span class="dzm-row-hint">Odtwarzana w widocznym miniplayerze w rogu ekranu (zgodnie z zasadami YouTube, bez ukrytego odtwarzania)</span><span class="dzm-url">https://youtube.com/playlist?list=…</span></span><span class="dzm-toggle"></span></div>
<div class="dzm-hsep"></div>
<div class="dzm-foot"><button type="button" class="dzm-btn" data-act="defaults">${icon('reset', 16)} PRZYWRÓĆ DOMYŚLNE</button><span class="dzm-grow"></span><button type="button" class="dzm-btn" data-act="back">${icon('arrowl', 16)} WSTECZ ${key('Esc')}</button><button type="button" class="dzm-btn dzm-btn--pri" data-act="apply">ZASTOSUJ ${key('Enter')}</button></div>
</div>
<div class="dzm-version">${o.version}</div>
${audioChips(false)}`;
  }

  function renderCredits(): string {
    return `<div class="dzm-logo dzm-logo--small">${WORDMARK}<div class="dzm-tag"><i></i><span>PRZETRWAJ. NIC WIĘCEJ.</span></div></div>
<div class="dzm-panel dzm-panel--credits" role="dialog" aria-label="Autorzy">
<div class="dzm-panel-head"><span class="dzm-panel-title">AUTORZY</span></div>
<div class="dzm-hsep"></div>
${CREDITS.map(([what, who]) => `<div class="dzm-credit"><span>${what}</span><em>${who}</em></div>`).join('')}
<div class="dzm-row-hint">Pełna lista z licencjami: ASSETS.md w repozytorium gry.</div>
<div class="dzm-foot"><span class="dzm-grow"></span><button type="button" class="dzm-btn" data-act="back">${icon('arrowl', 16)} WSTECZ ${key('Esc')}</button></div>
</div>
<div class="dzm-version">${o.version}</div>
${audioChips(false)}`;
  }

  function renderConfirm(): string {
    if (!confirm) return '';
    return `<div class="dzm-confirm" role="alertdialog" aria-label="${confirm.text}"><div class="dzm-confirm-box"><span>${confirm.text}</span><div class="dzm-foot"><button type="button" class="dzm-btn${confirm.focusYes ? '' : ' dzm-btn--focus'}" data-act="no">ANULUJ ${key('Esc')}</button><button type="button" class="dzm-btn dzm-btn--pri${confirm.focusYes ? ' dzm-btn--focus' : ''}" data-act="yes">${confirm.yes} ${key('Enter')}</button></div></div></div>`;
  }

  function render(): void {
    stage.innerHTML =
      (view === 'main' ? renderMain() : view === 'settings' ? renderSettings() : renderCredits()) +
      renderConfirm();
    el.dataset.view = view;
    o.setDimmed(view !== 'main');
    const f = stage.querySelector<HTMLElement>('[tabindex="0"]');
    if (f && document.activeElement !== f) f.focus({ preventScroll: true });
  }

  function setFocus(i: number): void {
    if (i === focus || items[i]?.disabled) return;
    focus = i;
    ui('ui-rollover2');
    render();
  }

  function toggleMusic(): void {
    settings.update((s) => ({ ...s, audio: { ...s.audio, menuMusic: !s.audio.menuMusic } }));
    draft = { ...draft, menuMusic: settings.get().audio.menuMusic };
    ui('ui-switch2');
    render();
  }

  function activate(id: ItemId): void {
    ui('ui-click1');
    note = '';
    if (id === 'continue') o.onStart({ mode, resume: true });
    else if (id === 'new' || id === 'modes') o.onStart({ mode, resume: false });
    else if (id === 'settings') {
      view = 'settings';
      draft = settings.get().audio;
      row = 0;
    } else if (id === 'credits') view = 'credits';
    else if (id === 'quit') {
      confirm = {
        text: 'Wyjść z gry?',
        yes: 'WYJDŹ',
        focusYes: true,
        onYes: () => {
          window.close();
          // Tabs not opened by script cannot be closed: tell the player instead.
          note = 'Zamknij kartę przeglądarki, aby wyjść.';
          render();
        },
      };
    }
    render();
  }

  function closeSettings(save: boolean): void {
    if (save) settings.update((s) => ({ ...s, audio: draft }));
    audio.preview(null);
    view = 'main';
    render();
  }

  function setDraft(next: AudioSettings, previewKey?: string): void {
    draft = next;
    audio.preview(draft);
    const now = performance.now();
    if (previewKey && now - lastPreviewMs > 90) {
      lastPreviewMs = now;
      if (previewKey === 'effects') audio.play('sfx', 'ui-switch2');
      else if (previewKey === 'voice' || previewKey === 'master') audio.play('ui', 'ui-click1');
    }
    render();
  }

  function settingsBack(): void {
    if (!dirty()) {
      ui('ui-click1');
      closeSettings(false);
      return;
    }
    confirm = {
      text: 'Odrzucić zmiany?',
      yes: 'ODRZUĆ',
      focusYes: false,
      onYes: () => closeSettings(false),
    };
    render();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.repeat && (e.code === 'Enter' || e.code === 'Escape')) return;
    const code = e.code;
    let handled = true;
    if (confirm) {
      const c = confirm;
      if (code === 'Escape') confirm = undefined;
      else if (code === 'Enter' || code === 'Space') {
        confirm = undefined;
        if (c.focusYes) c.onYes();
      } else if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'Tab') {
        c.focusYes = !c.focusYes;
      } else handled = false;
      if (handled) {
        ui('ui-click1');
        render();
      }
    } else if (view === 'main') {
      if (code === 'ArrowDown' || code === 'KeyS') setFocus(stepFocus(items, focus, 1));
      else if (code === 'ArrowUp' || code === 'KeyW') setFocus(stepFocus(items, focus, -1));
      else if (code === 'Enter' || code === 'Space') activate(items[focus]!.id);
      else if ((code === 'ArrowLeft' || code === 'ArrowRight') && items[focus]?.id === 'modes') {
        mode = mode === 'survive' ? 'rescue' : 'survive';
        ui('ui-switch2');
        render();
      } else if (code === 'Escape') {
        const quit = items.findIndex((it) => it.id === 'quit');
        if (focus === quit) activate('quit');
        else setFocus(quit);
      } else if (code === 'KeyM') toggleMusic();
      else handled = false;
    } else if (view === 'settings') {
      const rows = VOLUMES.length + 1;
      const vol = VOLUMES[row];
      const next = vol ? sliderKey(draft[vol.key], code, e.shiftKey) : undefined;
      if (vol && next !== undefined) setDraft({ ...draft, [vol.key]: next }, vol.key);
      else if (code === 'ArrowDown' || code === 'KeyS') {
        row = (row + 1) % rows;
        ui('ui-rollover2');
        render();
      } else if (code === 'ArrowUp' || code === 'KeyW') {
        row = (row + rows - 1) % rows;
        ui('ui-rollover2');
        render();
      } else if (code === 'Space' && row === VOLUMES.length) {
        ui('ui-switch2');
        setDraft({ ...draft, menuMusic: !draft.menuMusic });
      } else if (code === 'Enter') {
        ui('ui-click1');
        closeSettings(true);
      } else if (code === 'Escape') settingsBack();
      else if (code === 'KeyQ' || code === 'KeyE' || (code === 'Tab' && e.ctrlKey)) {
        // Only Audio exists so far; the other tabs are placeholders.
      } else handled = false;
    } else {
      if (code === 'Escape' || code === 'Enter') {
        ui('ui-click1');
        view = 'main';
        render();
      } else handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) {
      if (act === 'music') toggleMusic();
      else if (act === 'apply') {
        ui('ui-click1');
        closeSettings(true);
      } else if (act === 'back') {
        if (view === 'settings') settingsBack();
        else {
          ui('ui-click1');
          view = 'main';
          render();
        }
      } else if (act === 'defaults') {
        ui('ui-click1');
        setDraft({ ...DEFAULT_SETTINGS.audio, muted: draft.muted });
      } else if (act === 'yes' || act === 'no') {
        const c = confirm;
        confirm = undefined;
        ui('ui-click1');
        if (act === 'yes') c?.onYes();
        render();
      }
      return;
    }
    const m = t.closest<HTMLElement>('[data-mode]')?.dataset.mode as GameMode | undefined;
    if (m) {
      mode = m;
      ui('ui-switch2');
      render();
      return;
    }
    const item = t.closest<HTMLElement>('.dzm-item');
    if (item && item.getAttribute('aria-disabled') !== 'true') {
      activate(items[Number(item.dataset.i)]!.id);
      return;
    }
    const r = t.closest<HTMLElement>('.dzm-row[data-row]');
    if (r && Number(r.dataset.row) === VOLUMES.length) {
      row = VOLUMES.length;
      ui('ui-switch2');
      setDraft({ ...draft, menuMusic: !draft.menuMusic });
    }
  }

  function onOver(e: PointerEvent): void {
    const t = e.target as HTMLElement;
    const item = t.closest<HTMLElement>('.dzm-item');
    if (item && view === 'main' && !confirm) setFocus(Number(item.dataset.i));
    const r = t.closest<HTMLElement>('.dzm-row[data-row]');
    if (r && view === 'settings' && !confirm && Number(r.dataset.row) !== row) {
      row = Number(r.dataset.row);
      render();
    }
  }

  let dragKey: (typeof VOLUMES)[number]['key'] | undefined;
  function dragTo(e: PointerEvent): void {
    if (!dragKey) return;
    const track = stage.querySelector<HTMLElement>(`[data-track="${dragKey}"]`);
    if (!track) return;
    const b = track.getBoundingClientRect();
    const v = sliderAt(e.clientX, b.left, b.width);
    if (v !== draft[dragKey]) setDraft({ ...draft, [dragKey]: v }, dragKey);
  }
  function onDown(e: PointerEvent): void {
    const track = (e.target as HTMLElement).closest<HTMLElement>('[data-track]');
    if (!track || e.button !== 0) return;
    dragKey = track.dataset.track as (typeof VOLUMES)[number]['key'];
    row = VOLUMES.findIndex((v) => v.key === dragKey);
    dragTo(e);
    e.preventDefault();
  }
  const onMove = (e: PointerEvent): void => dragTo(e);
  const onUp = (): void => {
    dragKey = undefined;
  };

  function resize(): void {
    const s = menuScale(window.innerWidth, window.innerHeight);
    stage.style.width = `${window.innerWidth / s}px`;
    stage.style.height = `${window.innerHeight / s}px`;
    stage.style.transform = `scale(${s})`;
  }

  const unsub = settings.subscribe(() => {
    if (view === 'main') render();
  });
  document.addEventListener('keydown', onKey, { capture: true });
  el.addEventListener('click', onClick);
  el.addEventListener('pointerover', onOver);
  el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('resize', resize);
  resize();
  render();

  return {
    dispose() {
      unsub();
      audio.preview(null);
      document.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('resize', resize);
      el.remove();
    },
  };
}
