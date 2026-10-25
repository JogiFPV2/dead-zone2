import type { ZoomLimits } from '../../camera/zoom.js';
import { sliderAt, sliderFromZoom, zoomFromSlider } from './zoom-slider-model.js';

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

  let finger: number | undefined;
  const drag = (e: PointerEvent): void => {
    const r = track.getBoundingClientRect();
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
      shown = t;
      thumb.style.bottom = `${(t * 100).toFixed(1)}%`;
      el.setAttribute('aria-valuenow', zoom.toFixed(2));
    },
    dispose() {
      el.remove();
    },
  };
}
