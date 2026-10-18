import './target-card.css';
import type { TargetCardVM } from './target-card-model.js';

/**
 * Target card in the HUD v3 status block (under the HP bar): name + distance, a 3 px HP bar in
 * the zombie-HP colour bands, then behaviour, source and (aim only) the hit chance. No heavy
 * panel: a 3 px left rule and text shadow like the objective (spec HUD v3 „Cel bieżący”).
 */
export interface TargetCard {
  readonly el: HTMLElement;
  update(vm: TargetCardVM | undefined): void;
}

const LOCK_SVG =
  '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

export function createTargetCard(): TargetCard {
  const el = document.createElement('div');
  el.className = 'dz-tc';
  el.hidden = true;
  el.innerHTML = `<div class="dz-tc__r1"><span class="dz-tc__name"></span><span class="dz-tc__dist"></span></div>
<div class="dz-tc__r2"><div class="dz-tc__track"><i class="dz-tc__fill"></i></div><span class="dz-tc__hp"></span></div>
<div class="dz-tc__r3"><span class="dz-tc__src"></span><span class="dz-tc__state"></span><span class="dz-tc__hit"></span></div>`;
  const q = <T extends HTMLElement>(s: string): T => el.querySelector<T>(s)!;
  const name = q('.dz-tc__name');
  const dist = q('.dz-tc__dist');
  const fill = q('.dz-tc__fill');
  const src = q('.dz-tc__src');
  const state = q('.dz-tc__state');
  const hit = q('.dz-tc__hit');
  const hp = q('.dz-tc__hp');
  let key = '';
  return {
    el,
    update(vm) {
      const k = vm ? JSON.stringify(vm) : '';
      if (k === key) return;
      key = k;
      if (!vm) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.dataset.kind = vm.kind;
      el.dataset.band = vm.band;
      el.dataset.source = vm.source;
      el.toggleAttribute('data-dead', vm.state?.tone === 'dead');
      name.textContent = vm.name;
      dist.textContent = vm.distance;
      fill.style.transform = `scaleX(${(vm.hpPct / 100).toFixed(3)})`;
      src.innerHTML = `${vm.source === 'lock' ? LOCK_SVG : ''}<span>${vm.sourceLabel}</span>`;
      if (vm.state) {
        state.hidden = false;
        state.textContent = vm.state.label;
        state.dataset.tone = vm.state.tone;
      } else state.hidden = true;
      if (vm.hitChancePct !== undefined) {
        hit.hidden = false;
        hit.textContent = `TRAF. ${vm.hitChancePct}%`;
        hit.toggleAttribute('data-zero', vm.hitChancePct === 0);
      } else hit.hidden = true;
      hp.textContent = `${vm.hpPct}%`;
    },
  };
}
