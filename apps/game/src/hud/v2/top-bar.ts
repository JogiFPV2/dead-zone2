import './top-bar.css';
import { clockTime, gameDate } from './calendar.js';
import { chromeIcon } from './icons.js';
import { QUICK_ACCESS, type QuickAccessId } from './quick-access.js';

export interface TopBar {
  readonly el: HTMLElement;
  setClock(clock: { day: number; minuteOfDay: number } | undefined): void;
  /** Key labels per button (current bindings). */
  setKeys(keys: Readonly<Record<QuickAccessId, string>>): void;
  setActive(id: QuickAccessId | undefined): void;
  setNotify(id: QuickAccessId, on: boolean): void;
}

/** Tooltip delay (spec §2: 120 ms). */
const TIP_DELAY_MS = 120;

/**
 * HUD v2 top bar (spec §2): game date / time on the left, quick-access icons with key badges
 * and tooltips on the right. The only clock of the HUD.
 */
export function createTopBar(onSelect: (id: QuickAccessId) => void): TopBar {
  const el = document.createElement('div');
  el.className = 'dz-topbar';
  const left = document.createElement('div');
  left.className = 'dz-topbar__clock';
  const day = document.createElement('span');
  day.className = 'dz-topbar__day';
  const rest = document.createElement('span');
  rest.className = 'dz-topbar__date';
  left.append(chromeIcon('clock', 14, 'dz-ci dz-topbar__clock-ic'), day, rest);
  const nav = document.createElement('nav');
  nav.className = 'dz-topbar__nav';
  nav.setAttribute('aria-label', 'Szybki dostęp');
  el.append(left, nav);

  const items = new Map<QuickAccessId, { btn: HTMLButtonElement; key: HTMLElement }>();
  for (const def of QUICK_ACCESS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dz-qa';
    btn.dataset.id = def.id;
    const label = document.createElement('span');
    label.textContent = def.label;
    const key = document.createElement('span');
    key.className = 'dz-qa__key';
    const tip = document.createElement('span');
    tip.className = 'dz-qa__tip';
    tip.setAttribute('role', 'tooltip');
    const tipHint = document.createElement('span');
    tipHint.className = 'dz-qa__tip-hint';
    tipHint.textContent = `· ${def.hint}`;
    tip.append(chromeIcon(def.icon, 13, 'dz-ci dz-qa__tip-ic'), def.label, tipHint);
    const dot = document.createElement('i');
    dot.className = 'dz-qa__dot';
    btn.append(chromeIcon(def.icon, 13, 'dz-ci dz-qa__ic'), label, key, dot, tip);
    let timer: ReturnType<typeof setTimeout> | undefined;
    btn.addEventListener('pointerenter', () => {
      timer = setTimeout(() => (btn.dataset.tip = 'true'), TIP_DELAY_MS);
    });
    btn.addEventListener('pointerleave', () => {
      clearTimeout(timer);
      delete btn.dataset.tip;
    });
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.blur();
      onSelect(def.id);
    });
    nav.append(btn);
    items.set(def.id, { btn, key });
  }

  let clockText = '';
  return {
    el,
    setClock(clock) {
      const text = clock
        ? `${clock.day}|${gameDate(clock.day)} · ${clockTime(clock.minuteOfDay)}`
        : '';
      if (text === clockText) return;
      clockText = text;
      left.hidden = !clock;
      if (!clock) return;
      day.textContent = `Dzień ${clock.day}`;
      rest.textContent = `· ${gameDate(clock.day)} · ${clockTime(clock.minuteOfDay)}`;
    },
    setKeys(keys) {
      for (const [id, it] of items)
        if (it.key.textContent !== keys[id]) it.key.textContent = keys[id];
    },
    setActive(id) {
      for (const [k, it] of items) {
        if (k === id) it.btn.dataset.active = 'true';
        else delete it.btn.dataset.active;
      }
    },
    setNotify(id, on) {
      const it = items.get(id);
      if (!it) return;
      if (on) it.btn.dataset.notify = 'true';
      else delete it.btn.dataset.notify;
    },
  };
}
