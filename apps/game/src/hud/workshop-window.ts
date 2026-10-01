import './workshop-window.css';
import type { GameState } from '../state/game-state.js';
import { containerName } from './labels.js';
import type { HudContentIndex } from './content-index.js';
import { itemImage } from './item-icons.js';
import { clockLabel } from './loot-model.js';
import { actionProgress } from './hud-model.js';
import { recipeName } from './crafting-labels.js';
import {
  HAND,
  craftSkillsVM,
  formatMinutes,
  pickSelected,
  recipeDetailVM,
  recipeGroupsVM,
  stationsVM,
  upgradeVM,
  type PartVM,
  type RecipeFilter,
} from './workshop-model.js';

type CraftCmd =
  | { type: 'craft'; recipe: string; count?: number }
  | { type: 'upgradeStation'; x: number; y: number }
  | { type: 'cancelAction' };

export interface WorkshopWindowOptions {
  root: HTMLElement;
  send: (cmd: CraftCmd) => void;
  state: () => GameState;
  content: () => HudContentIndex;
  /** Player position (tiles) for station / container distances. */
  position: () => { x: number; y: number } | undefined;
}

export interface WorkshopWindow {
  readonly open: boolean;
  toggle(): void;
  close(): void;
  update(): void;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const ICON: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  hammer: '<path d="M14 6l4 4-9 9H5v-4z"/><path d="M13 7l4 4"/>',
  hand: '<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L8 13"/>',
  saw: '<path d="M3 15l12-12 3 3-12 12z"/><path d="M6 12l2 2M9 9l2 2M12 6l2 2"/>',
  wrench: '<path d="M14.5 5.5a4 4 0 0 0 5 5L12 18l-3 3-3-3 3-3 7.5-7.5a4 4 0 0 1-2-2z"/>',
  fire: '<path d="M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const svg = (name: string, size = 16, stroke = 2): string =>
  `<svg class="dz-ws__svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] ?? ''}</svg>`;
const key = (k: string): string => `<span class="dz-ws__key">${esc(k)}</span>`;

const STATION_ICON: Record<string, string> = {
  hand: 'hand',
  'base:station-workbench': 'saw',
  'base:station-mechanic': 'wrench',
  'base:station-fire': 'fire',
  'base:station-electronics': 'chip',
};

function itemIcon(item: string | undefined, size: number, fallback = 'box'): string {
  const url = item ? itemImage(item) : undefined;
  return url
    ? `<img src="${esc(url)}" alt="" width="${size}" height="${size}" draggable="false">`
    : svg(fallback, Math.round(size * 0.6));
}

function pips(level: number, max: number): string {
  let s = '';
  for (let i = 0; i < max; i++) s += `<i class="${i < level ? 'on' : ''}"></i>`;
  return `<span class="dz-ws__pips">${s}</span>`;
}

function partCard(p: PartVM, sub = ''): string {
  const pct = p.need > 0 ? Math.min(100, (p.have / p.need) * 100) : 100;
  return `<div class="dz-ws__part${p.ok ? '' : ' dz-ws__part--miss'}"><span class="dz-ws__pico">${itemIcon(p.item, 32)}</span>
<span class="dz-ws__pbody"><span class="dz-ws__pname">${esc(p.name)}</span>${sub ? `<span class="dz-ws__psub">${sub}</span>` : ''}</span>
<span class="dz-ws__pcount">${p.have}/${p.need}</span><span class="dz-ws__pbar"><i style="width:${pct.toFixed(0)}%"></i></span></div>`;
}

/**
 * Workshop / crafting window (mockup workshop.png): stations, recipes of the selected station,
 * recipe detail with amount, station upgrade. Parts count from the inventory and containers in
 * the crafting radius (the sim's crafting view already sums them).
 */
export function createWorkshopWindow(opts: WorkshopWindowOptions): WorkshopWindow {
  const el = document.createElement('div');
  el.className = 'dz-ws';
  el.hidden = true;
  el.innerHTML = `<div class="dz-ws__scrim"></div><div class="dz-ws__stage">
<div class="dz-ws__head"></div>
<div class="dz-ws__body">
<div class="dz-ws__panel dz-ws__left"></div>
<div class="dz-ws__panel dz-ws__mid"><div class="dz-ws__midhead"></div>
<div class="dz-ws__tools"><label class="dz-ws__search">${svg('search', 14)}<input type="text" placeholder="Szukaj przepisu…" spellcheck="false" autocomplete="off"></label><div class="dz-ws__filters"></div></div>
<div class="dz-ws__list"></div></div>
<div class="dz-ws__panel dz-ws__detail"></div>
</div>
<div class="dz-ws__panel dz-ws__upgrade"></div>
</div>`;
  opts.root.append(el);
  const $ = (s: string) => el.querySelector<HTMLElement>(s)!;
  const head = $('.dz-ws__head');
  const left = $('.dz-ws__left');
  const midHead = $('.dz-ws__midhead');
  const filters = $('.dz-ws__filters');
  const list = $('.dz-ws__list');
  const detail = $('.dz-ws__detail');
  const upgrade = $('.dz-ws__upgrade');
  const search = el.querySelector<HTMLInputElement>('.dz-ws__search input')!;

  let isOpen = false;
  let station = HAND;
  let filter: RecipeFilter = 'all';
  let query = '';
  let selected: string | undefined;
  let qty = 1;
  let lastKey = '';

  const pos = () => opts.position() ?? { x: 0, y: 0 };

  function render(): void {
    const s = opts.state();
    const c = opts.content();
    const p = pos();
    const stations = stationsVM(s.crafting, c, station, p.x, p.y);
    const st = stations.find((x) => x.selected) ?? stations[0]!;
    station = st.key;
    const groups = recipeGroupsVM(s.crafting, c, station, { filter, query, selected });
    selected = pickSelected(groups, selected);
    const d = recipeDetailVM(s.crafting, c, selected);
    qty = Math.max(1, Math.min(qty, Math.max(1, d?.max ?? 1)));

    // Header
    const clock = clockLabel(s.clock);
    const chip =
      st.key === HAND
        ? 'Bez stanowiska'
        : st.built
          ? `${st.name} · poziom ${st.level}/${st.maxLevel}`
          : `${st.name} · niezbudowany`;
    head.innerHTML = `<span class="dz-ws__title">WARSZTAT</span><span class="dz-ws__chip">${svg(STATION_ICON[st.key] ?? 'hammer', 14)} ${esc(chip)} ${st.key === HAND ? '' : pips(st.level, st.maxLevel)}</span>
<span class="dz-ws__grow"></span><span class="dz-ws__hint">Składniki z ekwipunku i pojemników w pobliżu · B / Esc zamknij</span>
<span class="dz-ws__clock"><b>${clock.time}</b><small>${esc(clock.day.toUpperCase())}</small></span>`;

    // Left: stations, skills, containers
    const built = stations.filter((x) => x.built).length;
    const stRows = stations
      .map((x) => {
        const cls = `dz-ws__station${x.selected ? ' dz-ws__station--sel' : ''}${x.built ? '' : ' dz-ws__station--off'}`;
        const sub =
          x.key === HAND
            ? `${x.recipes} przepisów · ${x.available} dostępne`
            : x.built
              ? `Aktywny · ${x.recipes} przepisów${x.distance !== undefined ? ` · ${x.distance} m stąd` : ''}`
              : esc(x.needs ?? 'Brak w pobliżu');
        const lvl =
          x.key === HAND
            ? ''
            : `<span class="dz-ws__slvl">${pips(x.level, x.maxLevel)} ${x.built ? `POZ. ${x.level}/${x.maxLevel}` : 'NIEZBUDOWANY'}</span>`;
        return `<button type="button" class="${cls}" data-station="${esc(x.key)}"><span class="dz-ws__sico">${svg(STATION_ICON[x.key] ?? 'hammer', 20)}</span>
<span class="dz-ws__sbody"><span class="dz-ws__sname">${esc(x.name)}</span>${lvl}<span class="dz-ws__ssub${x.built ? '' : ' dz-ws__danger'}">${sub}</span></span>${x.built ? '' : `<span class="dz-ws__slock">${svg('lock', 12)}</span>`}</button>`;
      })
      .join('');
    const skills = craftSkillsVM(s.skills, s.crafting)
      .map(
        (k) =>
          `<div class="dz-ws__skill"><span>${esc(k.name)}</span><b>${k.level} · ${Math.round(k.pct * 100)}%</b><span class="dz-ws__bar"><i style="width:${(k.pct * 100).toFixed(0)}%"></i></span></div>`,
      )
      .join('');
    const conts = s.nearby
      .map((n) => {
        const dist = Math.round(Math.hypot(n.x + 0.5 - p.x, n.y + 0.5 - p.y));
        return `<div class="dz-ws__cont">${svg('box', 13)}<span>${esc(containerName(n.type, n.kind))} · ${dist} m</span><b>${n.searched ? '' : 'nieprzeszukany'}</b></div>`;
      })
      .join('');
    left.innerHTML = `<div class="dz-ws__hdr"><span>STACJE</span><small>${built}/${stations.length} dostępne</small></div>
<div class="dz-ws__stations">${stRows}</div>
<div class="dz-ws__hdr"><span>UMIEJĘTNOŚCI</span></div><div class="dz-ws__skills">${skills || '<span class="dz-ws__muted">—</span>'}</div>
<div class="dz-ws__hdr"><span>POJEMNIKI W POBLIŻU</span></div><div class="dz-ws__conts"><div class="dz-ws__cont">${svg('box', 13)}<span>Ekwipunek</span><b></b></div>${conts}</div>`;

    // Middle: recipes
    const all = recipeGroupsVM(s.crafting, c, station, { filter: 'all', query: '', selected });
    const total = all.reduce((n, g) => n + g.rows.length, 0);
    const avail = all.reduce(
      (n, g) => n + g.rows.filter((r) => r.tone === 'ok' || r.tone === 'combo').length,
      0,
    );
    midHead.innerHTML = `<div class="dz-ws__hdr"><span>PRZEPISY · ${esc(st.name.toUpperCase())}</span><small>${avail} dostępne / ${total}</small></div>`;
    const f = (id: RecipeFilter, label: string) =>
      `<button type="button" class="dz-ws__filter${filter === id ? ' dz-ws__filter--on' : ''}" data-filter="${id}">${label}</button>`;
    filters.innerHTML =
      f('all', 'Wszystkie') + f('available', 'Dostępne') + f('hideLocked', 'Ukryj zablok.');
    list.innerHTML =
      groups
        .map(
          (g) =>
            `<div class="dz-ws__group"><span>${esc(g.name.toUpperCase())}</span><small>${g.rows.length}</small></div>` +
            g.rows
              .map(
                (r) =>
                  `<button type="button" class="dz-ws__recipe${r.selected ? ' dz-ws__recipe--sel' : ''}${r.locked ? ' dz-ws__recipe--lock' : ''}" data-recipe="${esc(r.id)}">
<span class="dz-ws__rico">${itemIcon(r.item, 30)}${r.locked ? `<span class="dz-ws__rlock">${svg('lock', 10, 2.4)}</span>` : ''}</span>
<span class="dz-ws__rbody"><span class="dz-ws__rname">${esc(r.name)}</span><span class="dz-ws__rsub dz-ws__rsub--${r.subTone}">${esc(r.sub)}</span></span>
<span class="dz-ws__badge dz-ws__badge--${r.tone}">${r.tone === 'lock' ? svg('lock', 10, 2.4) : ''}${esc(r.badge.toUpperCase())}</span></button>`,
              )
              .join(''),
        )
        .join('') ||
      `<div class="dz-ws__empty">${s.crafting ? 'Brak przepisów dla tego filtra' : 'Ładowanie przepisów…'}</div>`;

    // Right: detail
    if (!d) {
      detail.innerHTML = '<div class="dz-ws__empty">Wybierz przepis</div>';
    } else {
      const ok = d.state === 'available';
      const stChip = d.station
        ? `<span class="dz-ws__tag${d.station.ok ? ' dz-ws__tag--acc' : ' dz-ws__tag--dan'}">${esc(d.station.name)}: poz. ${d.station.minLevel}+ (masz ${d.station.level})</span>`
        : '';
      const skills = d.skills
        .map(
          (k) =>
            `<div class="dz-ws__part${k.ok ? '' : ' dz-ws__part--miss'}"><span class="dz-ws__pico">${svg('up', 16)}</span><span class="dz-ws__pbody"><span class="dz-ws__pname">${esc(k.name)} ${k.need}</span><span class="dz-ws__psub">masz ${k.have}</span></span><span class="dz-ws__pok">${svg(k.ok ? 'check' : 'x', 16, 2.6)}</span></div>`,
        )
        .join('');
      const tools = d.tools
        .map(
          (t) =>
            `<div class="dz-ws__part${t.ok ? '' : ' dz-ws__part--miss'}"><span class="dz-ws__pico">${itemIcon(t.item, 32, 'hammer')}</span><span class="dz-ws__pbody"><span class="dz-ws__pname">${esc(t.name)}</span><span class="dz-ws__psub">${t.ok ? 'pod ręką' : 'brak w pobliżu'}</span></span><span class="dz-ws__pok">${svg(t.ok ? 'check' : 'x', 16, 2.6)}</span></div>`,
        )
        .join('');
      const reqCols = [
        tools
          ? `<div class="dz-ws__col"><div class="dz-ws__lbl">NARZĘDZIA</div>${tools}</div>`
          : '',
        skills
          ? `<div class="dz-ws__col"><div class="dz-ws__lbl">UMIEJĘTNOŚĆ</div>${skills}</div>`
          : '',
      ].join('');
      detail.innerHTML = `<div class="dz-ws__dhead"><span class="dz-ws__dico">${itemIcon(d.item, 72)}</span>
<span class="dz-ws__dbody"><span class="dz-ws__dcat">${esc(d.category.toUpperCase())}</span><span class="dz-ws__dname">${esc(d.name)}</span>
<span class="dz-ws__dsub">${d.resultCount > 1 ? `Wynik: ${d.resultCount} szt. na wytworzenie` : 'Wynik: 1 szt.'}</span></span>
<span class="dz-ws__badge dz-ws__badge--${ok ? (d.max >= 2 ? 'combo' : 'ok') : d.state === 'missingParts' ? 'warn' : 'lock'}">${esc(ok && d.max >= 2 ? `MOŻNA +${d.max}` : d.stateLabel.toUpperCase())}</span></div>
<div class="dz-ws__tags"><span class="dz-ws__tag">Czas: ${formatMinutes(d.minutes)} / szt.</span>${stChip}</div>
<div class="dz-ws__lblrow"><span class="dz-ws__lbl">SKŁADNIKI × ${qty} SZT.</span><small>ekwipunek + pojemniki w pobliżu</small></div>
<div class="dz-ws__grid">${d.parts.map((p) => partCard({ ...p, need: p.need * qty, ok: p.have >= p.need * qty })).join('') || '<span class="dz-ws__muted">Brak składników</span>'}</div>
${reqCols ? `<div class="dz-ws__grid">${reqCols}</div>` : ''}
<div class="dz-ws__time">${svg('clock', 16)}<span>Czas wytwarzania</span><span class="dz-ws__grow"></span><small>${formatMinutes(d.minutes)} / szt.</small><b>${formatMinutes(d.minutes * qty)}</b></div>
<div class="dz-ws__grow"></div>
${craftProgress(s)}
<div class="dz-ws__actions"><div class="dz-ws__qty"><span class="dz-ws__lbl">ILOŚĆ</span><div class="dz-ws__stepper"><button type="button" data-qty="-1"${qty <= 1 ? ' disabled' : ''}>${svg('minus', 14)}</button><b>${qty}</b><button type="button" data-qty="1"${qty >= d.max ? ' disabled' : ''}>${svg('plus', 14)}</button></div></div>
<span class="dz-ws__maxnote">MAKS. ${d.max}</span><span class="dz-ws__grow"></span>
<button type="button" class="dz-ws__btn dz-ws__btn--sec" data-craft="all"${d.max >= 1 ? '' : ' disabled'}>WYTWÓRZ WSZYSTKIE ${key('Shift+E')}</button>
<button type="button" class="dz-ws__btn dz-ws__btn--pri" data-craft="qty"${d.max >= 1 ? '' : ' disabled'}>${svg('hammer', 16)} WYTWÓRZ ${key('E')}</button></div>`;
    }

    // Bottom: upgrade
    const up = upgradeVM(s.crafting, c, station, p.x, p.y);
    upgrade.hidden = !up;
    if (up) {
      const conds = [
        ...up.skills.map(
          (k) =>
            `<span class="dz-ws__tag${k.ok ? ' dz-ws__tag--ok' : ' dz-ws__tag--dan'}">${svg(k.ok ? 'check' : 'lock', 12)} ${esc(k.name)} ${k.need} (masz ${k.have})</span>`,
        ),
        ...up.tools.map(
          (t) =>
            `<span class="dz-ws__tag${t.ok ? ' dz-ws__tag--ok' : ' dz-ws__tag--dan'}">${svg('hammer', 12)} ${esc(t.name)}</span>`,
        ),
        `<span class="dz-ws__tag">${svg('clock', 12)} ${formatMinutes(up.minutes)}</span>`,
      ].join('');
      upgrade.innerHTML = `<div class="dz-ws__uphead"><span class="dz-ws__uptitle">${svg('up', 16)} ULEPSZ ${esc(up.stationName.toUpperCase())} DO POZ. ${up.toLevel}</span><small>Krótszy czas wytwarzania i nowe przepisy</small></div>
<div class="dz-ws__upcol"><span class="dz-ws__lbl">WYMAGANE MATERIAŁY</span><div class="dz-ws__upparts">${up.parts.map((x) => `<span class="dz-ws__upp${x.ok ? '' : ' dz-ws__upp--miss'}">${itemIcon(x.item, 22)}${esc(x.name)} <b>${x.have}/${x.need}</b></span>`).join('')}</div></div>
<div class="dz-ws__upcol"><span class="dz-ws__lbl">WARUNKI</span><div class="dz-ws__upparts">${conds}</div></div>
<button type="button" class="dz-ws__btn dz-ws__btn--pri" data-upgrade${up.ready ? '' : ' disabled'}>${svg('up', 16)} ULEPSZ</button>`;
      upgrade.dataset.x = String(up.x);
      upgrade.dataset.y = String(up.y);
    }
  }

  /** Running craft (the sim's timed action): recipe, % and queue, with a cancel button. */
  function craftProgress(s: GameState): string {
    const a = s.action;
    if (a?.kind !== 'craft') return '';
    const pct = Math.round((actionProgress(s, s.tick) ?? 0) * 100);
    const queue = a.queued > 0 ? ` · w kolejce ${a.queued}` : '';
    return `<div class="dz-ws__progress"><div class="dz-ws__progtop">${svg('hammer', 14)}<span>Wytwarzanie: <b>${esc(a.recipe ? recipeName(a.recipe) : '')}</b>${queue}</span><span class="dz-ws__grow"></span><b>${pct}%</b><button type="button" class="dz-ws__cancel" data-cancel>Przerwij</button></div><div class="dz-ws__bar"><i style="width:${pct}%"></i></div></div>`;
  }

  function craft(all: boolean): void {
    const d = recipeDetailVM(opts.state().crafting, opts.content(), selected);
    if (!d || d.max < 1) return;
    const count = all ? d.max : Math.min(qty, d.max);
    opts.send({ type: 'craft', recipe: d.id, count });
  }

  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || (t as HTMLButtonElement).disabled) return;
    if (t.dataset.station) {
      station = t.dataset.station;
      selected = undefined;
      qty = 1;
    } else if (t.dataset.filter) filter = t.dataset.filter as RecipeFilter;
    else if (t.dataset.recipe) {
      if (selected !== t.dataset.recipe) qty = 1;
      selected = t.dataset.recipe;
    } else if (t.dataset.qty) qty += Number(t.dataset.qty);
    else if (t.dataset.craft) craft(t.dataset.craft === 'all');
    else if (t.hasAttribute('data-cancel')) opts.send({ type: 'cancelAction' });
    else if (t.hasAttribute('data-upgrade'))
      opts.send({
        type: 'upgradeStation',
        x: Number(upgrade.dataset.x),
        y: Number(upgrade.dataset.y),
      });
    render();
  });
  search.addEventListener('input', () => {
    query = search.value;
    render();
  });

  const onKey = (e: KeyboardEvent): void => {
    if (!isOpen) return;
    const typing = e.target === search;
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (typing && search.value) {
        search.value = '';
        query = '';
        render();
      } else api.close();
      return;
    }
    if (typing) {
      e.stopPropagation();
      return;
    }
    if (e.code === 'KeyE') {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'keydown' && !e.repeat) craft(e.shiftKey);
    } else if (e.code === 'KeyQ') {
      e.stopPropagation();
    }
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKey, true);

  const stateKey = (): string => {
    const s = opts.state();
    const prog = s.action ? Math.round((actionProgress(s, s.tick) ?? 0) * 100) : -1;
    return [
      s.crafting,
      s.skills,
      s.nearby,
      s.action,
      prog,
      Math.floor(s.clock?.minuteOfDay ?? 0),
      opts.content(),
    ]
      .map((x) => (typeof x === 'object' ? identity(x) : String(x)))
      .join('|');
  };
  const ids = new WeakMap<object, number>();
  let nextId = 1;
  function identity(o: object | undefined | null): string {
    if (!o) return '-';
    let id = ids.get(o);
    if (id === undefined) {
      id = nextId++;
      ids.set(o, id);
    }
    return String(id);
  }

  const api: WorkshopWindow = {
    get open() {
      return isOpen;
    },
    toggle() {
      if (isOpen) api.close();
      else {
        isOpen = true;
        el.hidden = false;
        opts.root.dataset.modal = 'workshop';
        lastKey = '';
        // Start at the nearest built station, else hand crafting.
        const p = pos();
        const st = stationsVM(opts.state().crafting, opts.content(), station, p.x, p.y)
          .filter((x) => x.built && x.key !== HAND)
          .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (st && station === HAND) station = st.key;
        render();
      }
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      el.hidden = true;
      search.blur();
      if (opts.root.dataset.modal === 'workshop') opts.root.dataset.modal = '';
    },
    update() {
      if (!isOpen) return;
      const k = stateKey();
      if (k !== lastKey) {
        lastKey = k;
        render();
      }
    },
  };
  return api;
}
