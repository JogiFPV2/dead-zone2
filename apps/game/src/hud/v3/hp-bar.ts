import { hpLevel } from './hud3-model.js';

export interface HpBar {
  readonly el: HTMLElement;
  update(hp: number): void;
}

/** HUD v3 thin HP bar (bottom left, always visible): `HP ▬▬▬▬▬▭ 72`. */
export function createHpBar(): HpBar {
  const el = document.createElement('div');
  el.className = 'dz-hp3';
  const label = document.createElement('span');
  label.className = 'dz-hp3__label';
  label.textContent = 'HP';
  const track = document.createElement('span');
  track.className = 'dz-hp3__track';
  const fill = document.createElement('i');
  fill.className = 'dz-hp3__fill';
  track.append(fill);
  const value = document.createElement('span');
  value.className = 'dz-hp3__value';
  el.append(label, track, value);
  let last = NaN;
  return {
    el,
    update(hp) {
      const v = Math.max(0, Math.min(100, Math.round(hp)));
      if (v === last) return;
      last = v;
      fill.style.transform = `scaleX(${v / 100})`;
      value.textContent = String(v);
      el.dataset.level = hpLevel(v);
    },
  };
}
