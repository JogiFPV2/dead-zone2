import '@deadzone/ui/hud.css';
import './main-menu.css';
import type { AudioEngine } from '../audio/audio-engine.js';
import type { SettingsStore } from '../settings/store.js';
import { WORDMARK, icon } from './icons.js';
import { firstEnabled, menuScale, stepFocus } from './menu-model.js';
import { createSettingsScreen, type SettingsScreen } from './settings-screen.js';
import type { CharacterStore } from '../characters/character-store.js';
import { MAX_LIVING_CHARACTERS, type CharacterRecord } from '../characters/schema.js';
import { createCharactersScreen, type CharactersScreen } from './characters-screen.js';
import { uiScale } from '../ui/ui-scale.js';

export type GameMode = 'survive' | 'rescue';

/** What the menu starts: the last living character, a new one (creator), or a chosen one. */
export type MenuStart =
  | { kind: 'continue' }
  | { kind: 'new'; mode: GameMode; from?: 'characters' }
  | { kind: 'play'; character: CharacterRecord };

export interface MainMenuOptions {
  readonly root: HTMLElement;
  readonly settings: SettingsStore;
  readonly audio: AudioEngine;
  /** „Dzień 4 · Riverside · 2 godz. temu”; undefined = no save → „Kontynuuj” hidden. */
  readonly continueInfo?: string | undefined;
  /** Postacie screen; undefined = the item is hidden. */
  readonly characters?: CharacterStore | undefined;
  /** Living-character limit reached: Nowa gra opens Postacie instead of the creator. */
  readonly slotsFull?: boolean;
  /** Open Postacie right away (back from the creator). */
  readonly startView?: 'characters';
  readonly version: string;
  readonly track: { readonly title: string; readonly credit: string };
  /** Background blur for sub-screens. */
  setDimmed(dim: boolean): void;
  onStart(choice: MenuStart): void;
}

export interface MainMenu {
  dispose(): void;
}

type View = 'main' | 'settings' | 'credits' | 'characters';
type ItemId = 'continue' | 'new' | 'modes' | 'characters' | 'settings' | 'credits' | 'quit';

interface Item {
  id: ItemId;
  icon: string;
  label: string;
  sub?: string;
  disabled?: boolean;
}

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
    ...(o.characters ? [{ id: 'characters' as const, icon: 'user', label: 'Postacie' }] : []),
    { id: 'settings', icon: 'gear', label: 'Ustawienia' },
    { id: 'credits', icon: 'users', label: 'Autorzy' },
    { id: 'quit', icon: 'exit', label: 'Wyjdź' },
  ];
  let view: View = o.startView ?? 'main';
  let focus = firstEnabled(items);
  let mode: GameMode = 'survive';
  let confirm: { text: string; yes: string; onYes: () => void; focusYes: boolean } | undefined;
  let note = '';
  // Ustawienia: the shared screen (settings-screen.ts) over the dimmed menu.
  let settingsScreen: SettingsScreen | undefined;
  // Postacie: one card per character slot (characters-screen.ts).
  let charactersScreen: CharactersScreen | undefined;
  let charactersNote: string | undefined;

  const ui = (id: 'ui-click1' | 'ui-rollover2' | 'ui-switch2'): void => audio.play('ui', id);
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
      (view === 'main' ? renderMain() : view === 'credits' ? renderCredits() : '') +
      renderConfirm();
    el.dataset.view = view;
    o.setDimmed(view !== 'main');
    const f = stage.querySelector<HTMLElement>('[tabindex="0"]');
    if (f && document.activeElement !== f) f.focus({ preventScroll: true });
    if (view === 'settings' && !settingsScreen) openSettings();
    if (view === 'characters' && !charactersScreen) openCharacters();
  }

  function openCharacters(): void {
    if (!o.characters) return;
    const note = charactersNote;
    charactersNote = undefined;
    charactersScreen = createCharactersScreen({
      root: el,
      store: o.characters,
      audio,
      note,
      onPlay(character) {
        charactersScreen = undefined;
        o.onStart({ kind: 'play', character });
      },
      onNew() {
        charactersScreen = undefined;
        o.onStart({ kind: 'new', mode, from: 'characters' });
      },
      onClose() {
        charactersScreen = undefined;
        view = 'main';
        render();
      },
    });
  }

  function setFocus(i: number): void {
    if (i === focus || items[i]?.disabled) return;
    focus = i;
    ui('ui-rollover2');
    render();
  }

  function toggleMusic(): void {
    settings.update((s) => ({ ...s, audio: { ...s.audio, menuMusic: !s.audio.menuMusic } }));
    ui('ui-switch2');
    render();
  }

  function openSettings(): void {
    settingsScreen = createSettingsScreen({
      root: el,
      settings,
      audio,
      trackTitle: o.track.title,
      onClose() {
        settingsScreen = undefined;
        view = 'main';
        render();
      },
    });
  }

  function activate(id: ItemId): void {
    ui('ui-click1');
    note = '';
    if (id === 'continue') {
      o.onStart({ kind: 'continue' });
      return;
    }
    if ((id === 'new' || id === 'modes') && !(o.slotsFull && o.characters)) {
      o.onStart({ kind: 'new', mode });
      return;
    }
    if (id === 'new' || id === 'modes') {
      charactersNote = `Limit ${MAX_LIVING_CHARACTERS} żywych postaci: usuń postać, aby zacząć nową grę.`;
      view = 'characters';
    } else if (id === 'characters') view = 'characters';
    else if (id === 'settings') view = 'settings';
    else if (id === 'credits') view = 'credits';
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
      handled = settingsScreen?.onKey(e) ?? false;
    } else if (view === 'characters') {
      handled = charactersScreen?.onKey(e) ?? false;
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
      else if (act === 'back') {
        ui('ui-click1');
        view = 'main';
        render();
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
  }

  function onOver(e: PointerEvent): void {
    const t = e.target as HTMLElement;
    const item = t.closest<HTMLElement>('.dzm-item');
    if (item && view === 'main' && !confirm) setFocus(Number(item.dataset.i));
  }

  function resize(): void {
    const s = menuScale(window.innerWidth, window.innerHeight) * uiScale();
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
  window.addEventListener('resize', resize);
  resize();
  render();

  return {
    dispose() {
      unsub();
      settingsScreen?.dispose();
      charactersScreen?.dispose();
      document.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('resize', resize);
      el.remove();
    },
  };
}
