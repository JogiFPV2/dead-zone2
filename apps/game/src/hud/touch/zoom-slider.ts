import type { ZoomLimits } from '../../camera/zoom.js';
import { sliderAt, sliderFromZoom, zoomFromSlider } from './zoom-slider-model.js';

/** Back to the 0.2 rest opacity this long after the last use (CSS fades it in 300 ms). */
export const ZOOM_SLIDER_IDLE_MS = 2000;

export interface TouchZoomSlider {
  readonly el: HTMLElement;
  /** Per frame: follow the zoom target (pinch changes it too). */
  update(zoom: number): void;
  dispose(): void;
}

/**
 * Right-edge vertical slider (touch.css `.dz-touch__zoom`): drag up = closer, down = wider.
 * Sits between the top bar and the thumb buttons (touch-layout.ts TOUCH_ZOOM).
 */
export function createTouchZoomSlider(
  parent: HTMLElement,
  limits: Pick<ZoomLimits, 'min' | 'max'>,
  set: (zoom: number) => void,
): TouchZoomSlider {
  const el = document.createElement('div');
  el.className = 'dz-touch__zoom';
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', 'Przybliżenie widoku');
  el.setAttribute('aria-orientation', 'vertical');
  const plus = document.createElement('b');
  plus.textContent = '+';
  const minus = document.createElement('b');
  minus.textContent = '−';
  const track = document.createElement('div');
  track.className = 'dz-touch__zoomtrack';
  const thumb = document.createElement('i');
  track.append(thumb);
  el.append(plus, track, minus);

  // Spec: rest 0.2, active 1.0 at once (touch, drag, pinch), back 2 s after the last use.
  let fade: ReturnType<typeof setTimeout> | undefined;
  const activate = (): void => {
    el.dataset.active = 'true';
    clearTimeout(fade);
    fade = setTimeout(() => delete el.dataset.active, ZOOM_SLIDER_IDLE_MS);
  };
  let finger: number | undefined;
  const drag = (e: PointerEvent): void => {
    const r = track.getBoundingClientRect();
    activate();
    set(zoomFromSlider(sliderAt(e.clientY, r.top, r.height), limits));
  };
  const down = (e: PointerEvent): void => {
    if (finger !== undefined) return;
    e.preventDefault();
    e.stopPropagation();
    finger = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    el.dataset.down = 'true';
    drag(e);
  };
  const move = (e: PointerEvent): void => {
    if (e.pointerId === finger) drag(e);
  };
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== finger) return;
    finger = undefined;
    delete el.dataset.down;
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  parent.append(el);

  let shown = -1;
  return {
    el,
    update(zoom) {
      const t = sliderFromZoom(zoom, limits);
      if (Math.abs(t - shown) < 1e-3) return;
      // A change not from the finger (pinch) lights the slider too; not the first draw.
      if (shown >= 0) activate();
      shown = t;
      thumb.style.bottom = `${(t * 100).toFixed(1)}%`;
      el.setAttribute('aria-valuenow', zoom.toFixed(2));
    },
    dispose() {
      clearTimeout(fade);
      el.remove();
    },
  };
}
