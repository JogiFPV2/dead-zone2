import './minimap-zoom-controls.css';
import { canZoomIn, canZoomOut, stepMinimapZoom, wheelSteps } from './minimap-zoom.js';

export interface MinimapZoomControls {
  readonly el: HTMLElement;
  get(): number;
  set(zoom: number): void;
}

/**
 * Small +/− buttons beside the minimap (and the wheel over the minimap), discrete steps from
 * minimap-zoom.ts. `onChange` gets every new zoom (apply + persist).
 */
export function createMinimapZoomControls(
  minimap: HTMLElement,
  initial: number,
  onChange: (zoom: number) => void,
): MinimapZoomControls {
  let zoom = initial;
  const el = document.createElement('div');
  el.className = 'dz-mmzoom';
  const button = (label: string, title: string, dir: 1 | -1): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dz-mmzoom__btn';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      step(dir);
    });
    return b;
  };
  const plus = button('+', 'Przybliż minimapę', 1);
  const minus = button('−', 'Oddal minimapę', -1);
  el.append(plus, minus);

  const sync = (): void => {
    plus.disabled = !canZoomIn(zoom);
    minus.disabled = !canZoomOut(zoom);
  };
  const step = (dir: 1 | -1): void => {
    const next = stepMinimapZoom(zoom, dir);
    if (next === zoom) return;
    zoom = next;
    sync();
    onChange(zoom);
  };
  let acc = 0;
  minimap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = wheelSteps(acc, e.deltaY);
      acc = r.acc;
      if (r.step) step(r.step);
    },
    { passive: false },
  );
  sync();
  return {
    el,
    get: () => zoom,
    set(z) {
      zoom = z;
      sync();
    },
  };
}
