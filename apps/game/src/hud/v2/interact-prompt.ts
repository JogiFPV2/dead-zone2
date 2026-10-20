import './interact-prompt.css';

export type PromptVM =
  | { mode: 'hidden' }
  | {
      mode: 'prompt';
      x: number;
      y: number;
      key: string;
      search: boolean;
      /** Verb after the key (default `Otwórz`; doors: `Zamknij`, `Zamknięte`). */
      label?: string;
      /** Hold verb (default `Przeszukaj`; openings: `Więcej` = the action menu). */
      hold?: string;
    }
  | {
      /** Opening action menu (hold F at a door / gate / window): numbered entries. */
      mode: 'menu';
      x: number;
      y: number;
      key: string;
      title: string;
      items: string[];
      sel: number;
    }
  | {
      mode: 'search';
      x: number;
      y: number;
      key: string;
      /** 0..1 */
      progress: number;
      name: string;
      seconds: number;
      /** A zombie sees / chases the player: the ring pulses red, the search goes on (HUD v3). */
      threat?: boolean;
      /** Panel title (default `Przeszukiwanie`; openings: `Barykadowanie` …). */
      title?: string;
    };

export interface InteractPrompt {
  readonly el: HTMLElement;
  update(vm: PromptVM): void;
  /** Menu entry clicked / hovered (index). */
  onMenu?: (i: number, kind: 'pick' | 'hover') => void;
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
  const pHold = span('dz-ip__hold');
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
  const sTitle = span('dz-ip__title', 'Przeszukiwanie');
  panel.append(sTitle, sKey, sTime);

  // Zombies never interrupt a search (only moving / attacking): warn instead of cancelling.
  const threat = span('dz-ip__threat', 'Zagrożenie · ruch przerywa');
  threat.setAttribute('role', 'status');

  const menu = document.createElement('div');
  menu.className = 'dz-ip__menu';
  const mTitle = span('dz-ip__menu-title');
  const mList = document.createElement('div');
  mList.className = 'dz-ip__menu-list';
  menu.append(mTitle, mList);

  el.append(ring, marker, prompt, panel, threat, menu);

  let last = '';
  const api: InteractPrompt = {
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
        el.removeAttribute('data-threat');
        pKey.textContent = vm.key;
        pOpen.textContent = vm.label ?? 'Otwórz';
        pSep.hidden = !vm.search;
        pHold.hidden = !vm.search;
        pHold.textContent = `przytrzymaj ${vm.key} ${vm.hold ?? 'Przeszukaj'}`;
        return;
      }
      if (vm.mode === 'menu') {
        el.removeAttribute('data-threat');
        mTitle.textContent = vm.title;
        mList.replaceChildren(
          ...vm.items.map((label, i) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `dz-ip__menu-item${i === vm.sel ? ' dz-ip__menu-item--sel' : ''}`;
            row.append(span('dz-ip__key', String(i + 1)), span('', label));
            row.addEventListener('click', () => api.onMenu?.(i, 'pick'));
            row.addEventListener('mouseenter', () => api.onMenu?.(i, 'hover'));
            return row;
          }),
        );
        return;
      }
      const p = Math.min(1, Math.max(0, vm.progress));
      arc.setAttribute('stroke-dasharray', `${(p * C).toFixed(2)} ${C.toFixed(2)}`);
      peak.style.transform = `rotate(${(p * 360).toFixed(1)}deg)`;
      pct.textContent = `${Math.floor(p * 100)}%`;
      name.textContent = vm.name;
      sTitle.textContent = vm.title ?? 'Przeszukiwanie';
      sKey.textContent = vm.key;
      sTime.textContent = `${vm.seconds.toFixed(1).replace('.', ',')} s`;
      el.toggleAttribute('data-threat', vm.threat === true);
    },
  };
  return api;
}
