import './overlay.css';
import { uiScale } from '../ui/ui-scale.js';

/** Overlays (Ustawienia, pauza, potwierdzenia) are authored at the mockups' 1280×720. */
export const OVERLAY_W = 1280;
export const OVERLAY_H = 720;

export function overlayScale(width: number, height: number): number {
  return Math.max(0.5, Math.min(3, width / OVERLAY_W, height / OVERLAY_H));
}

export interface OverlayStage {
  /** Full-screen layer (`position:absolute; inset:0`). */
  readonly el: HTMLElement;
  /** 1280×720 coordinate space, scaled to fit and centred. */
  readonly stage: HTMLElement;
  dispose(): void;
}

/** Full-screen layer with a scaled 1280×720 stage, appended to `root`. */
export function mountOverlay(root: HTMLElement, className: string): OverlayStage {
  const el = document.createElement('div');
  el.className = `dzo ${className}`;
  const stage = document.createElement('div');
  stage.className = 'dzo-stage';
  el.appendChild(stage);
  root.appendChild(el);
  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const s = overlayScale(w, h) * uiScale();
    stage.style.transform = `translate(${(w - OVERLAY_W * s) / 2}px, ${(h - OVERLAY_H * s) / 2}px) scale(${s})`;
  };
  window.addEventListener('resize', resize);
  resize();
  return {
    el,
    stage,
    dispose() {
      window.removeEventListener('resize', resize);
      el.remove();
    },
  };
}

/** Key badge (`ESC`, `ENTER`) of the overlays. */
export const keyBadge = (k: string, accent = false): string =>
  `<span class="dzo-key${accent ? ' dzo-key--accent' : ''}">${k}</span>`;

/** Small DEADZONE wordmark, top left of every overlay. */
export const MINI_LOGO = '<div class="dzo-logo" aria-hidden="true">DEADZONE<i></i></div>';
