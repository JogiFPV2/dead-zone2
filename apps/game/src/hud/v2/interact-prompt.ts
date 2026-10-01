import './interact-prompt.css';

export type PromptVM =
  | { mode: 'hidden' }
  | { mode: 'prompt'; x: number; y: number; key: string; search: boolean }
  | {
      mode: 'search';
      x: number;
      y: number;
      key: string;
      /** 0..1 */
      progress: number;
      name: string;
      seconds: number;
    };

export interface InteractPrompt {
  readonly el: HTMLElement;
  update(vm: PromptVM): void;
}

const NS = 'http://www.w3.org/2000/svg';
/** Ring Ø116, stroke 3 (spec §6): radius to the stroke centre. */
const R = 56.5;
const C = 2 * Math.PI * R;

const span = (cls: string, text = ''): HTMLSpanElement => {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
};

/**
 * Interaction prompt at the object (`[F] Otwórz / przytrzymaj F Przeszukaj`) and the search
 * ring (`68%` / `Lodówka`, `PRZESZUKIWANIE [F] 3,5 s`), HUD v2 spec §6. Anchored at the
 * object's screen point (x, y in CSS px of the HUD root).
 */
export function createInteractPrompt(): InteractPrompt {
  const el = document.createElement('div');
  el.className = 'dz-ip';
  el.hidden = true;
  const marker = span('dz-ip__marker');

  const prompt = document.createElement('div');
  prompt.className = 'dz-ip__prompt';
  const pKey = span('dz-ip__key dz-ip__key--primary');
  const pOpen = span('', 'Otwórz');
  const pSep = span('dz-ip__sep', '/');
  const pHold = span('');
  prompt.append(pKey, pOpen, pSep, pHold);

  const ring = document.createElement('div');
  ring.className = 'dz-ip__ring';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-60 -60 120 120');
  svg.setAttribute('class', 'dz-ip__svg');
  const track = document.createElementNS(NS, 'circle');
  track.setAttribute('class', 'dz-ip__track');
  track.setAttribute('r', String(R));
  const arc = document.createElementNS(NS, 'circle');
  arc.setAttribute('class', 'dz-ip__arc');
  arc.setAttribute('r', String(R));
  arc.setAttribute('stroke-dasharray', `0 ${C}`);
  svg.append(track, arc);
  const peak = span('dz-ip__peak');
  const center = document.createElement('div');
  center.className = 'dz-ip__center';
  const pct = span('dz-ip__pct');
  const name = span('dz-ip__name');
  center.append(pct, name);
  ring.append(svg, peak, center);

  const panel = document.createElement('div');
  panel.className = 'dz-ip__panel';
  const sKey = span('dz-ip__key');
  const sTime = span('dz-ip__secs');
  panel.append(span('dz-ip__title', 'Przeszukiwanie'), sKey, sTime);

  el.append(ring, marker, prompt, panel);

  let last = '';
  return {
    el,
    update(vm) {
      const key = JSON.stringify(vm);
      if (key === last) return;
      last = key;
      el.hidden = vm.mode === 'hidden';
      if (vm.mode === 'hidden') return;
      el.dataset.mode = vm.mode;
      el.style.setProperty('--ip-x', `${vm.x.toFixed(1)}px`);
      el.style.setProperty('--ip-y', `${vm.y.toFixed(1)}px`);
      if (vm.mode === 'prompt') {
        pKey.textContent = vm.key;
        pSep.hidden = !vm.search;
        pHold.hidden = !vm.search;
        pHold.textContent = `przytrzymaj ${vm.key} Przeszukaj`;
        return;
      }
      const p = Math.min(1, Math.max(0, vm.progress));
      arc.setAttribute('stroke-dasharray', `${(p * C).toFixed(2)} ${C.toFixed(2)}`);
      peak.style.transform = `rotate(${(p * 360).toFixed(1)}deg)`;
      pct.textContent = `${Math.floor(p * 100)}%`;
      name.textContent = vm.name;
      sKey.textContent = vm.key;
      sTime.textContent = `${vm.seconds.toFixed(1).replace('.', ',')} s`;
    },
  };
}
