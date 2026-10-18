import './melee-widget.css';
import { itemImage } from './item-icons.js';
import { WEAPON_BROKE_MS, type MeleeVM } from './melee-model.js';

/**
 * Weapon panel for a held non-firearm item (same slot as the ammo widget, right 18 /
 * bottom 73): item icon, name, grey IMPROWIZOWANA / PRZEDMIOT tag, OBURĄCZ chip and the
 * durability bar. Never hidden while an item is in hand (no calm fade, unlike the ammo widget).
 * `broke()` keeps the last item for WEAPON_BROKE_MS: grey, shaking icon and an empty red bar.
 */
export interface MeleeWidget {
  readonly el: HTMLElement;
  update(vm: MeleeVM | undefined, now: number): void;
  /** `weaponBroke` for the local player. */
  broke(itemId: string, now: number): void;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const FALLBACK_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 19 17 7M14 4l6 6M4 20l2-2"/></svg>';

export function createMeleeWidget(): MeleeWidget {
  const el = document.createElement('div');
  el.className = 'dz-mw';
  el.hidden = true;
  let key = '';
  let last: MeleeVM | undefined;
  let brokeUntil = 0;

  function render(vm: MeleeVM, broken: boolean): void {
    const img = itemImage(vm.weapon);
    const icon = img
      ? `<img src="${esc(img)}" alt="" draggable="false">`
      : `<span class="dz-mw__vec">${FALLBACK_SVG}</span>`;
    const pct = broken ? 0 : vm.conditionPct;
    const bar =
      pct === undefined
        ? ''
        : `<div class="dz-mw__dur"><div class="dz-mw__track"><i style="transform:scaleX(${(pct / 100).toFixed(3)})"></i></div><span class="dz-mw__pct">${pct}%</span></div>`;
    el.dataset.source = vm.source;
    el.dataset.level = broken ? 'low' : vm.level;
    el.toggleAttribute('data-broke', broken);
    el.title = vm.stats;
    el.innerHTML = `<div class="dz-mw__panel"><div class="dz-mw__top"><div class="dz-mw__icon">${icon}</div><div class="dz-mw__txt"><div class="dz-mw__name">${esc(vm.name.toUpperCase())}</div><div class="dz-mw__tags">${vm.tag ? `<span class="dz-mw__tag">${vm.tag}</span>` : ''}${vm.twoHanded ? '<span class="dz-mw__chip">OBURĄCZ</span>' : ''}</div></div></div>${bar}</div>`;
  }

  return {
    el,
    update(vm, now) {
      const broken = now < brokeUntil && last !== undefined;
      const show = broken ? last : vm;
      if (!show) {
        if (!el.hidden) el.hidden = true;
        key = '';
        return;
      }
      if (!broken) last = vm;
      const k = `${broken ? 'B' : ''}${JSON.stringify(show)}`;
      el.hidden = false;
      if (k === key) return;
      key = k;
      render(show, broken);
    },
    broke(itemId, now) {
      if (!last || last.weapon !== itemId) return;
      brokeUntil = now + WEAPON_BROKE_MS;
      key = '';
    },
  };
}
