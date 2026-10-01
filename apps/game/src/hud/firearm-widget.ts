import './firearm-widget.css';
import { itemImage } from './item-icons.js';
import type { FirearmVM, HintVM } from './firearm-model.js';

/**
 * FirearmWidget (spec §1–3): 200×82 glass panel docked beside the hotbar (inside its group, so
 * it scales with it), with a hint tag above. Structure re-renders when the state changes;
 * reload ring / bar / seconds update every frame.
 */
export interface FirearmWidget {
  readonly el: HTMLElement;
  /** Every frame; undefined hides the widget. */
  update(vm: FirearmVM | undefined, dock: 'left' | 'right'): void;
  /** LMB on an empty gun: short shake (dry click). */
  dryFire(): void;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const RING_R = 13;
const RING_C = 2 * Math.PI * RING_R;
const FLASH_STATES = new Set(['low', 'empty', 'jammed']);

function hintHtml(h: HintVM | undefined): string {
  if (!h) return '';
  const key = h.key
    ? `<span class="dz-fw__key${h.key.length > 1 ? ' dz-fw__key--wide' : ''}">${esc(h.key)}</span>`
    : '';
  return `<div class="dz-fw__hint" data-variant="${h.variant}"${h.disabled ? ' data-disabled' : ''}>${key}<span>${esc(h.label.toUpperCase())}</span></div>`;
}

function pipsHtml(vm: FirearmVM): string {
  if (vm.state === 'reloading') return `<div class="dz-fw__prog"><i></i></div>`;
  if (vm.pips === 'none') return '';
  if (vm.pips === 'pill')
    return `<div class="dz-fw__pill"><i style="width:${(100 * vm.loaded) / Math.max(1, vm.capacity)}%"></i></div>`;
  const cls = vm.pips === 'shells' ? 'dz-fw__shell' : 'dz-fw__bar';
  let out = '';
  for (let i = 0; i < vm.capacity; i++) {
    const on = i < vm.loaded;
    const loading = vm.state === 'shell' && i === vm.loaded;
    out += `<i class="${cls}${on ? ' on' : ''}${loading ? ' loading' : ''}">${vm.pips === 'shells' ? '<b></b>' : ''}</i>`;
  }
  return `<div class="dz-fw__pips dz-fw__pips--${vm.pips}">${out}</div>`;
}

function counterHtml(vm: FirearmVM): string {
  if (vm.state === 'reloading')
    return `<svg class="dz-fw__ring" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="${RING_R}" class="dz-fw__ringtrack"/><circle cx="15" cy="15" r="${RING_R}" class="dz-fw__ringarc" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}" transform="rotate(-90 15 15)"/></svg><b class="dz-fw__state dz-fw__sec">0.0 s</b>`;
  if (vm.capacity <= 0 && vm.state !== 'jammed')
    return `<b class="dz-fw__state dz-fw__state--muted">BRAK MAG.</b>`;
  if (vm.state === 'empty')
    return `<b class="dz-fw__state">PUSTY</b><span class="dz-fw__cap">0/${vm.capacity}</span>`;
  if (vm.state === 'jammed') return `<b class="dz-fw__state">ZACIĘCIE</b>`;
  return `<b class="dz-fw__count">${vm.loaded}</b><span class="dz-fw__cap">/${vm.capacity}</span>${vm.state === 'low' ? '<span class="dz-fw__low">MAŁO</span>' : ''}`;
}

const WARN_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18v.5"/></svg>';

export function createFirearmWidget(): FirearmWidget {
  const el = document.createElement('div');
  el.className = 'dz-fw';
  el.hidden = true;
  let key = '';
  let lastState = '';
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const structKey = (vm: FirearmVM, dock: string): string =>
    JSON.stringify([
      dock,
      vm.weapon,
      vm.state,
      vm.title,
      vm.loaded,
      vm.capacity,
      vm.reserve,
      vm.reserveMags,
      vm.pips,
      vm.hint,
    ]);

  function render(vm: FirearmVM, dock: 'left' | 'right'): void {
    el.dataset.state = vm.state;
    el.dataset.dock = dock;
    const img = itemImage(vm.ammo);
    const icon = img ? `<img class="dz-fw__ammo" src="${esc(img)}" alt="" draggable="false">` : '';
    el.innerHTML = `${hintHtml(vm.hint)}<div class="dz-fw__panel">
<div class="dz-fw__r1"><span class="dz-fw__name">${vm.state === 'jammed' ? WARN_SVG : ''}<span>${esc(vm.title.toUpperCase())}</span></span><span class="dz-fw__zl">ZAPAS</span></div>
<div class="dz-fw__r2"><div class="dz-fw__main">${counterHtml(vm)}</div><span class="dz-fw__res">${icon}<b>${vm.reserve}</b></span></div>
<div class="dz-fw__r3">${pipsHtml(vm)}</div></div>`;
  }

  function frame(vm: FirearmVM): void {
    const p = vm.progress ?? 0;
    if (vm.state === 'reloading') {
      el.querySelector('.dz-fw__ringarc')?.setAttribute(
        'stroke-dashoffset',
        (RING_C * (1 - p)).toFixed(2),
      );
      const sec = el.querySelector('.dz-fw__sec');
      if (sec) sec.textContent = `${(vm.secLeft ?? 0).toFixed(1)} s`;
      const bar = el.querySelector<HTMLElement>('.dz-fw__prog i');
      if (bar) bar.style.transform = `scaleX(${p})`;
    } else if (vm.state === 'shell') {
      const s = el.querySelector<HTMLElement>('.dz-fw__shell.loading');
      if (s) s.style.setProperty('--fill', String(p));
    }
  }

  return {
    el,
    update(vm, dock) {
      if (!vm) {
        el.hidden = true;
        key = '';
        lastState = '';
        return;
      }
      el.hidden = false;
      const k = structKey(vm, dock);
      if (k !== key) {
        key = k;
        render(vm, dock);
        if (vm.state !== lastState && FLASH_STATES.has(vm.state)) {
          el.classList.remove('dz-fw--flash');
          void el.offsetWidth;
          el.classList.add('dz-fw--flash');
          clearTimeout(flashTimer);
          flashTimer = setTimeout(() => el.classList.remove('dz-fw--flash'), 650);
        }
        lastState = vm.state;
      }
      frame(vm);
    },
    dryFire() {
      if (el.hidden) return;
      el.classList.remove('dz-fw--shake');
      void el.offsetWidth;
      el.classList.add('dz-fw--shake');
    },
  };
}
