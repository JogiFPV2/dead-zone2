import type { AudioEngine } from '../audio/audio-engine.js';
import type { CharacterStore } from '../characters/character-store.js';
import { MAX_LIVING_CHARACTERS, type CharacterRecord } from '../characters/schema.js';
import {
  NEW_FOCUS,
  cardView,
  feminine,
  moveFocus,
  type CardView,
  type CharFocus,
} from './characters-model.js';
import { createConfirm, type ConfirmDialog } from './confirm-dialog.js';
import { icon } from './icons.js';
import { MINI_LOGO, keyBadge, mountOverlay } from './overlay-stage.js';

export interface CharactersScreenOptions {
  readonly root: HTMLElement;
  readonly store: CharacterStore;
  readonly audio?: AudioEngine | undefined;
  /** Note under the title (e.g. the living-character limit). */
  readonly note?: string | undefined;
  /** Graj: the screen is already disposed. */
  onPlay(c: CharacterRecord): void;
  /** Nowa postać: the screen is already disposed. */
  onNew(): void;
  /** Esc / wstecz: the screen is already disposed. */
  onClose(): void;
  now?: () => number;
}

/** Cards visible at once in the 1280×720 stage (244 px + 12 px gap). */
const VISIBLE_CARDS = 4;
const CARD_STEP = 256;

/** Row scroll that keeps card `i` in view (unchanged for Nowa postać). */
export function scrollFor(i: number, current: number): number {
  if (i < 0) return current;
  const left = i * CARD_STEP;
  if (left < current) return left;
  const right = left - (VISIBLE_CARDS - 1) * CARD_STEP;
  return right > current ? right : current;
}

export interface CharactersScreen {
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const color = (c: string): string => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#555');

function portraitHtml(v: CardView): string {
  if (v.dead) return `<div class="dzo-portrait dzo-portrait--dead">${icon('grave', 52)}</div>`;
  const p = v.portrait;
  return `<div class="dzo-portrait" aria-hidden="true"><i class="dzo-pt-body" style="background:${color(p.shirt)}"></i><i class="dzo-pt-neck" style="background:${color(p.skin)}"></i><i class="dzo-pt-head" style="background:${color(p.skin)}"></i><i class="dzo-pt-hair" style="background:${color(p.hair)}"></i><i class="dzo-pt-eyes"></i></div>`;
}

/**
 * Postacie (deadzone-menu-spec §7, mockups characters.png / characters-delete.png): one card per
 * character (slot), Graj / Usuń with a confirm, Nowa postać. Tombstones only offer Usuń.
 */
export function createCharactersScreen(o: CharactersScreenOptions): CharactersScreen {
  const overlay = mountOverlay(o.root, 'dzo--chars');
  const now = o.now ?? Date.now;
  let chars: CharacterRecord[] = [];
  let cards: CardView[] = [];
  let focus: CharFocus = { card: 0, action: 0 };
  let confirm: ConfirmDialog | undefined;
  let disposed = false;
  let note = o.note ?? '';
  /** Horizontal scroll of the card row (more than 4 cards). */
  let scroll = 0;

  const ui = (id: 'ui-click1' | 'ui-rollover2'): void => o.audio?.play('ui', id);
  const alive = (): number => chars.filter((c) => c.status === 'alive').length;
  const canCreate = (): boolean => alive() < MAX_LIVING_CHARACTERS;

  async function load(): Promise<void> {
    chars = await o.store.list();
    if (disposed) return;
    const active = chars.find((c) => c.status === 'alive')?.id;
    const t = now();
    cards = chars.map((c) => cardView(c, t, c.id === active));
    if (!cards.length) focus = NEW_FOCUS;
    else if (focus.card >= cards.length) focus = { card: cards.length - 1, action: 0 };
    render();
  }

  function cardHtml(v: CardView, i: number): string {
    const focused = focus.card === i;
    const btn = (a: 'play' | 'delete', j: number): string => {
      const f = focused && focus.action === j;
      if (a === 'play') {
        return `<button type="button" class="dzo-btn dzo-card-btn ${focused ? 'dzo-btn--pri' : 'dzo-btn--sec'}${f ? ' dzo-btn--focus' : ''}" data-card="${i}" data-act="play" tabindex="${f ? 0 : -1}">${icon('play', 13)}GRAJ</button>`;
      }
      const wide = v.actions.length === 1;
      return `<button type="button" class="dzo-btn dzo-card-btn dzo-card-del${wide ? ' dzo-card-del--wide' : ''}${f ? ' dzo-btn--focus' : ''}" data-card="${i}" data-act="delete" tabindex="${f ? 0 : -1}" aria-label="Usuń postać ${esc(v.name)}">${icon('trash', 13)}${wide ? 'USUŃ' : ''}</button>`;
    };
    return `<div class="dzo-card${focused ? ' dzo-card--focus' : ''}${v.dead ? ' dzo-card--dead' : ''}" data-card="${i}" role="group" aria-label="${esc(v.name)}">
${portraitHtml(v)}<div class="dzo-card-body"><div class="dzo-card-name">${esc(v.name)}</div><div class="dzo-card-sub">${esc(v.sub)}</div>
<div class="dzo-card-stat"><span>${v.days.label}</span><b>${v.days.value}</b></div>
<div class="dzo-card-stat dzo-card-stat--2"><span>${v.second.label}</span><em${v.second.danger ? ' class="dzo-danger"' : ''}>${esc(v.second.value)}</em></div>
<div class="dzo-card-actions">${v.actions.map(btn).join('')}</div></div></div>`;
  }

  function render(): void {
    if (disposed) return;
    const empty = Array.from(
      // Placeholders fill the visible row (4 cards) while new characters fit.
      { length: canCreate() ? Math.max(0, VISIBLE_CARDS - cards.length) : 0 },
      () =>
        `<div class="dzo-card dzo-card--empty" aria-hidden="true"><span>WOLNE MIEJSCE</span></div>`,
    ).join('');
    const newFocus = focus.card < 0;
    overlay.stage.innerHTML = `${MINI_LOGO}
<div class="dzo-chars-head"><div class="dzo-chars-title">POSTACIE</div><div class="dzo-chars-sub">KAŻDA POSTAĆ · JEDNA GRA</div></div>
<div class="dzo-chars-slots">${icon('user', 15)}<span>${alive()} / ${MAX_LIVING_CHARACTERS} żywych postaci</span></div>
<div class="dzo-chars-row">${cards.map(cardHtml).join('')}${empty}</div>
<button type="button" class="dzo-btn dzo-chars-new${newFocus ? ' dzo-btn--focus' : ''}" data-act="new" tabindex="${newFocus ? 0 : -1}"${canCreate() ? '' : ' aria-disabled="true"'}>${icon('plus', 16)} NOWA POSTAĆ${canCreate() ? '' : `<em>· limit ${MAX_LIVING_CHARACTERS} żywych postaci</em>`}</button>
${note ? `<div class="dzo-chars-note">${icon('warning', 14)}<span>${esc(note)}</span></div>` : ''}
<div class="dzo-chars-back" data-act="back">${keyBadge('ESC')} wstecz</div>`;
    const row = overlay.stage.querySelector<HTMLElement>('.dzo-chars-row');
    if (row) row.scrollLeft = scrollFor(focus.card, scroll);
    scroll = row?.scrollLeft ?? 0;
    if (!confirm) {
      overlay.stage.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
    }
  }

  function close(then: () => void): void {
    dispose();
    then();
  }

  function askDelete(i: number): void {
    const c = chars[i];
    if (!c) return;
    confirm = createConfirm({
      host: overlay.stage,
      title: 'USUNĄĆ POSTAĆ?',
      body: `„${esc(c.name)}” i ${feminine(c.name) ? 'jej' : 'jego'} świat zostaną usunięte bezpowrotnie.<br><span class="dzo-danger">Tej operacji nie można cofnąć.</span>`,
      yes: 'USUŃ POSTAĆ',
      danger: true,
      icon: 'trash',
      onAnswer(yes) {
        confirm = undefined;
        if (!yes) {
          render();
          return;
        }
        note = '';
        void o.store.remove(c.id).then(load, (e: unknown) => {
          note = `Nie udało się usunąć postaci: ${String(e)}`;
          render();
        });
      },
    });
  }

  function activate(f: CharFocus): void {
    ui('ui-click1');
    if (f.card < 0) {
      if (canCreate()) close(() => o.onNew());
      return;
    }
    const v = cards[f.card];
    const act = v?.actions[f.action];
    if (act === 'play') close(() => o.onPlay(chars[f.card]!));
    else if (act === 'delete') askDelete(f.card);
  }

  function setFocus(f: CharFocus): void {
    if (f.card === focus.card && f.action === focus.action) return;
    focus = f;
    ui('ui-rollover2');
    render();
  }

  function onClick(e: MouseEvent): void {
    if (confirm) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = t?.dataset.act;
    if (!t || !act) return;
    if (act === 'back') {
      ui('ui-click1');
      close(() => o.onClose());
    } else if (act === 'new') activate(NEW_FOCUS);
    else {
      const card = Number(t.dataset.card);
      const action = cards[card]?.actions.indexOf(act as 'play' | 'delete') ?? -1;
      if (action >= 0) {
        focus = { card, action };
        activate(focus);
      }
    }
  }

  function onOver(e: PointerEvent): void {
    if (confirm) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'new') setFocus(NEW_FOCUS);
    else if (t.dataset.card !== undefined) {
      const card = Number(t.dataset.card);
      const action = cards[card]?.actions.indexOf(t.dataset.act as 'play' | 'delete') ?? -1;
      if (action >= 0) setFocus({ card, action });
    }
  }

  overlay.el.addEventListener('click', onClick);
  overlay.el.addEventListener('pointerover', onOver);
  render();
  void load().catch((e: unknown) => {
    note = `Nie udało się wczytać postaci: ${String(e)}`;
    render();
  });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    confirm?.dispose();
    overlay.dispose();
  }

  return {
    onKey(e) {
      if (disposed) return false;
      if (confirm) {
        const handled = confirm.onKey(e);
        if (handled) ui('ui-click1');
        return handled;
      }
      const c = e.code;
      if (c === 'Escape') {
        ui('ui-click1');
        close(() => o.onClose());
        return true;
      }
      if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') {
        if (!e.repeat) activate(focus);
        return true;
      }
      if (c === 'Delete' && focus.card >= 0) {
        ui('ui-click1');
        askDelete(focus.card);
        return true;
      }
      const next = moveFocus(focus, c, cards, canCreate());
      if (!next) return false;
      setFocus(next);
      return true;
    },
    dispose,
  };
}
