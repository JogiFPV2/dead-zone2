import './minimap-zoom-controls.css';
import { canZoomIn, canZoomOut, stepMinimapZoom, wheelSteps, zoomLabel } from './minimap-zoom.js';

export interface MinimapZoomControls {
  readonly el: HTMLElement;
  get(): number;
}

export interface MinimapZoomHandlers {
  /** Draw at this zoom (called every frame of the 160 ms scale animation). */
  apply: (zoom: number) => void;
  /** New target zoom (persist). */
  change: (zoom: number) => void;
}

/** Scale change animation (HUD v2 spec §4: 160 ms ease-out). */
const ANIM_MS = 160;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/**
 * Minimap zoom (HUD v2 spec §4): `−` / `+` (23×23) at the bottom of the minimap, the level
 * (`1,0×`) beside them, and the wheel over the minimap. Steps from minimap-zoom.ts.
 */
export function createMinimapZoomControls(
  minimap: HTMLElement,
  initial: number,
  handlers: MinimapZoomHandlers,
): MinimapZoomControls {
  let zoom = initial;
  let shown = initial;
  let frame = 0;
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
  const minus = button('−', 'Oddal minimapę', -1);
  const plus = button('+', 'Przybliż minimapę', 1);
  const level = document.createElement('div');
  level.className = 'dz-mmzoom__level';
  const row = document.createElement('div');
  row.className = 'dz-mmzoom__row';
  row.append(minus, plus);
  el.append(row, level);

  const sync = (): void => {
    plus.disabled = !canZoomIn(zoom);
    minus.disabled = !canZoomOut(zoom);
    level.textContent = zoomLabel(zoom);
  };
  const animate = (from: number, to: number): void => {
    cancelAnimationFrame(frame);
    const t0 = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - t0) / ANIM_MS);
      shown = from + (to - from) * easeOut(t);
      handlers.apply(shown);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  const step = (dir: 1 | -1): void => {
    const next = stepMinimapZoom(zoom, dir);
    if (next === zoom) return;
    zoom = next;
    sync();
    animate(shown, zoom);
    handlers.change(zoom);
  };
  let acc = 0;
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const r = wheelSteps(acc, e.deltaY);
    acc = r.acc;
    if (r.step) step(r.step);
  };
  minimap.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('wheel', onWheel, { passive: false });
  sync();
  return { el, get: () => shown };
}
