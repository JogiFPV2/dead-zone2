import './character-window.css';
import type { BodyPart } from '@deadzone/protocol';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex } from '../hud/content-index.js';
import type { CommandBody } from '../sim/sim-client.js';
import {
  CHARACTER_TABS,
  SKILL_MAX_LEVEL,
  characterVM,
  journalTime,
  skillsVM,
  type CharacterTab,
  type Journal,
  type WoundAction,
} from './character-model.js';

export interface CharacterWindowOptions {
  root: HTMLElement;
  state: () => GameState;
  content: () => HudContentIndex;
  journal: Journal;
  /** Sends a wound treatment; returns the command `seq` (rejections are matched by it). */
  send: (cmd: CommandBody) => number;
}

export interface CharacterWindow {
  readonly open: boolean;
  readonly tab: CharacterTab;
  /** Opens at `tab`; pressing the key of the open tab closes it. */
  toggle(tab: CharacterTab): void;
  close(): void;
  update(): void;
}

/** `#app[data-modal]` while open: the tab id (the top bar highlights its button). */
const MODALS: ReadonlySet<string> = new Set(CHARACTER_TABS.map((t) => t.id));

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function bar(pct: number, cls = ''): string {
  return `<span class="dz-ch__bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(0)}%"></i></span>`;
}

function characterHtml(s: GameState, content: HudContentIndex): string {
  const vm = characterVM(s, content);
  const stats = vm.stats
    .map(
      (r) =>
        `<div class="dz-ch__stat${r.warn ? ' dz-ch__stat--warn' : ''}"><span>${esc(r.label)}</span>${bar(r.value, r.bad ? 'dz-ch__bar--bad' : '')}<b>${r.value}</b></div>`,
    )
    .join('');
  const body = [
    vm.temperatureC !== undefined
      ? `<div class="dz-ch__kv"><span>Temperatura ciała</span><b>${vm.temperatureC.toFixed(1)} °C</b></div>`
      : '',
    vm.weightKg !== undefined
      ? `<div class="dz-ch__kv"><span>Masa ciała</span><b>${vm.weightKg.toFixed(1)} kg</b></div>`
      : '',
  ].join('');
  const traits = vm.traits.length
    ? vm.traits.map((t) => `<span class="dz-ch__trait">${esc(t.name)}</span>`).join('')
    : '<span class="dz-ch__muted">Brak cech</span>';
  const wounds = vm.wounds.length
    ? vm.wounds
        .map((w) => {
          const flags = w.flags.length
            ? `<span class="dz-ch__flags">${esc(w.flags.join(' · '))}</span>`
            : '';
          const acts = w.actions
            .map(
              (a) =>
                `<button type="button" class="dz-ch__btn" data-part="${w.part}" data-act="${a.id}"${a.ready ? '' : ` disabled title="${esc(a.missing ?? '')}"`}>${esc(a.label)}</button>`,
            )
            .join('');
          return `<div class="dz-ch__wound${w.bleeding > 0 ? ' dz-ch__wound--bleed' : ''}">
<div class="dz-ch__whead"><b>${esc(w.partLabel)}</b><span>${esc(w.wounds)}</span></div>
<div class="dz-ch__wstate"><span>krwawienie ${w.bleeding}</span><span>zagojenie ${w.healedPct}%</span>${flags}</div>
${acts ? `<div class="dz-ch__acts">${acts}</div>` : ''}</div>`;
        })
        .join('')
    : '<span class="dz-ch__muted">Brak ran</span>';
  return `<div class="dz-ch__cols">
<section class="dz-ch__panel"><h3>Stan</h3>${stats}${body}</section>
<section class="dz-ch__panel"><h3>Rany</h3>${wounds}</section>
<section class="dz-ch__panel"><h3>Cechy</h3><div class="dz-ch__traits">${traits}</div></section>
</div>`;
}

function skillsHtml(s: GameState): string {
  return `<div class="dz-ch__cols">${skillsVM(s)
    .map(
      (g) =>
        `<section class="dz-ch__panel"><h3>${esc(g.label)}</h3>${g.skills
          .map(
            (k) =>
              `<div class="dz-ch__skill"><span class="dz-ch__sname">${esc(k.name)}</span><span class="dz-ch__lvl">${k.level}<small>/${SKILL_MAX_LEVEL}</small></span>${bar(k.pct)}<span class="dz-ch__xp">${esc(k.xpText)}</span></div>`,
          )
          .join('')}</section>`,
    )
    .join('')}</div>`;
}

function journalHtml(s: GameState, journal: Journal): string {
  const vm = characterVM(s, { moodles: new Map(), items: new Map() });
  const entries = journal.entries.length
    ? journal.entries
        .map((e) => `<li><time>${esc(journalTime(e))}</time><span>${esc(e.text)}</span></li>`)
        .join('')
    : '<li class="dz-ch__muted">Na razie nic się nie wydarzyło.</li>';
  return `<div class="dz-ch__cols">
<section class="dz-ch__panel dz-ch__summary"><h3>Przetrwanie</h3>
<div class="dz-ch__kv"><span>Dzień</span><b>${vm.day ?? '–'}</b></div>
<div class="dz-ch__kv"><span>Zabite zombie</span><b>${vm.kills}</b></div>
<p class="dz-ch__muted">Dziennik zapisuje, co ważnego spotkało postać w tej sesji gry.</p></section>
<section class="dz-ch__panel dz-ch__log"><h3>Wydarzenia</h3><ol>${entries}</ol></section>
</div>`;
}

/**
 * Character window (H / K / J, top bar „Postać”, „Umiejętności”, „Dziennik”): stats, wounds with
 * treatment buttons and traits; skills by group; the session journal.
 */
export function createCharacterWindow(opts: CharacterWindowOptions): CharacterWindow {
  const el = document.createElement('div');
  el.className = 'dz-ch';
  el.hidden = true;
  el.innerHTML = `<div class="dz-ch__scrim"></div><div class="dz-ch__stage">
<div class="dz-ch__head"><div class="dz-ch__who"></div><nav class="dz-ch__tabs">${CHARACTER_TABS.map(
    (t) =>
      `<button type="button" data-tab="${t.id}">${esc(t.label)} <span class="dz-ch__key">${t.key}</span></button>`,
  ).join('')}</nav><button type="button" class="dz-ch__close" aria-label="Zamknij">×</button></div>
<div class="dz-ch__body"></div></div>`;
  opts.root.append(el);
  const who = el.querySelector<HTMLElement>('.dz-ch__who')!;
  const body = el.querySelector<HTMLElement>('.dz-ch__body')!;
  let isOpen = false;
  let tab: CharacterTab = 'character';
  let lastKey = '';

  /** Renders when the visible text changes (rounded values), not on every tick. */
  function render(): void {
    const s = opts.state();
    const vm = characterVM(s, opts.content());
    const html =
      `<b>${esc(vm.name)}</b>${vm.profession ? `<span>${esc(vm.profession)}</span>` : ''}` +
      '\u0000' +
      (tab === 'character'
        ? characterHtml(s, opts.content())
        : tab === 'skills'
          ? skillsHtml(s)
          : journalHtml(s, opts.journal));
    if (html === lastKey) return;
    lastKey = html;
    const [head = '', main = ''] = html.split('\u0000');
    who.innerHTML = head;
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-tab]'))
      b.classList.toggle('on', b.dataset.tab === tab);
    body.innerHTML = main;
  }

  // Treatments on press: the list re-renders as bleeding changes, a click could miss.
  el.addEventListener('pointerdown', (ev) => {
    const act = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    if (!act || act.disabled || ev.button !== 0) return;
    const part = act.dataset.part as BodyPart;
    const a = act.dataset.act as WoundAction;
    opts.send(
      a === 'bandage' ? { type: 'bandage', part } : { type: 'treatWound', part, treatment: a },
    );
  });

  el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest('.dz-ch__close') || t.classList.contains('dz-ch__scrim')) {
      api.close();
      return;
    }
    const tabBtn = t.closest<HTMLElement>('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab as CharacterTab;
      opts.root.dataset.modal = tab;
      lastKey = '';
      api.update();
    }
  });

  const api: CharacterWindow = {
    get open() {
      return isOpen;
    },
    get tab() {
      return tab;
    },
    toggle(next) {
      if (isOpen && tab === next) {
        api.close();
        return;
      }
      tab = next;
      isOpen = true;
      el.hidden = false;
      opts.root.dataset.modal = tab;
      lastKey = '';
      api.update();
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      el.hidden = true;
      if (MODALS.has(opts.root.dataset.modal ?? '')) opts.root.dataset.modal = '';
    },
    update() {
      if (isOpen) render();
    },
  };
  return api;
}
