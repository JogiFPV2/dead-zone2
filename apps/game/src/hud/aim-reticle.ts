import './aim-reticle.css';

/**
 * Firearm aim reticle (spec §4): replaces the cursor while RMB is held with a firearm in hand.
 * Dot Ø4, spread circle (stroke 1.5) and 4 ticks r+3…r+10, over a dark 3.5 px under-stroke;
 * distance chip to the right (zombie under the cursor) and the „HAŁAS” chip below.
 */
export interface ReticleFrame {
  active: boolean;
  /** Cursor in px inside the game root. */
  x: number;
  y: number;
  /** Target radius (px, already clamped); eased here over `motion.fast`. */
  r: number;
  warn: boolean;
  outOfRange: boolean;
  /** Reloading: cannot shoot (circle `color.text.disabled`). */
  disabled: boolean;
  distanceM?: number | undefined;
  noiseRadius: number;
  now: number;
}

export interface AimReticle {
  readonly el: HTMLElement;
  update(f: ReticleFrame): void;
}

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 132;
const C = SIZE / 2;
const EASE_MS = 120;

const SPEAKER =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';

export function createAimReticle(parent: HTMLElement): AimReticle {
  const el = document.createElement('div');
  el.className = 'dz-reticle';
  el.hidden = true;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(SIZE));
  svg.setAttribute('height', String(SIZE));
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  const layer = (cls: string) => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', cls);
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', String(C));
    circle.setAttribute('cy', String(C));
    circle.setAttribute('class', 'dz-reticle__ring');
    const ticks = document.createElementNS(NS, 'path');
    ticks.setAttribute('class', 'dz-reticle__ticks');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(C));
    dot.setAttribute('cy', String(C));
    dot.setAttribute('r', '2');
    dot.setAttribute('class', 'dz-reticle__dot');
    g.append(circle, ticks, dot);
    svg.append(g);
    return { circle, ticks };
  };
  const under = layer('dz-reticle__under');
  const top = layer('dz-reticle__top');
  const dist = document.createElement('span');
  dist.className = 'dz-reticle__dist';
  const noise = document.createElement('span');
  noise.className = 'dz-reticle__noise';
  el.append(svg, dist, noise);
  parent.append(el);

  let r = 0;
  let lastNow = 0;
  let lastNoise = -1;
  let wasActive = false;

  return {
    el,
    update(f) {
      if (!f.active) {
        if (wasActive) el.hidden = true;
        wasActive = false;
        return;
      }
      if (!wasActive) r = f.r;
      wasActive = true;
      el.hidden = false;
      const dt = Math.max(0, f.now - lastNow);
      lastNow = f.now;
      r += (f.r - r) * Math.min(1, dt / EASE_MS);
      el.style.transform = `translate3d(${(f.x - C).toFixed(1)}px, ${(f.y - C).toFixed(1)}px, 0)`;
      el.dataset.tone = f.disabled ? 'disabled' : f.outOfRange ? 'range' : f.warn ? 'warn' : '';
      const d = `M${C} ${C - r - 3}V${C - r - 10}M${C} ${C + r + 3}V${C + r + 10}M${C - r - 3} ${C}H${C - r - 10}M${C + r + 3} ${C}H${C + r + 10}`;
      for (const l of [under, top]) {
        l.circle.setAttribute('r', r.toFixed(1));
        l.ticks.setAttribute('d', d);
      }
      dist.hidden = f.distanceM === undefined;
      if (f.distanceM !== undefined) {
        dist.textContent = `${Math.round(f.distanceM)} m`;
        dist.style.left = `${(C + r + 16).toFixed(1)}px`;
      }
      noise.style.top = `${(C + r + 16).toFixed(1)}px`;
      if (f.noiseRadius !== lastNoise) {
        lastNoise = f.noiseRadius;
        noise.innerHTML = `${SPEAKER}<span>HAŁAS ${Math.round(f.noiseRadius)} m</span>`;
      }
    },
  };
}
