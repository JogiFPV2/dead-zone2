import type { WebGLRenderer } from 'three';
import { createFpsMeter } from './fps.js';
import { formatStats } from './format.js';

const REFRESH_MS = 250;

/** Dev-only overlay. Loaded via dynamic import behind import.meta.env.DEV, so absent from prod. */
/** `extra` adds a second line (e.g. the crowd benchmark). */
export function createStatsOverlay(
  parent: HTMLElement,
  extra?: () => string | undefined,
): (renderer: WebGLRenderer) => void {
  const el = document.createElement('div');
  el.dataset.devStats = '';
  Object.assign(el.style, {
    position: 'fixed',
    // Bottom left: the HUD leaves that corner free (spec §2); top left has moodles and hints.
    bottom: '8px',
    left: '8px',
    padding: '4px 8px',
    font: '12px/1.4 ui-monospace, monospace',
    color: '#e6e6e6',
    background: 'rgba(0, 0, 0, 0.6)',
    borderRadius: '4px',
    pointerEvents: 'none',
    zIndex: '1000',
    whiteSpace: 'pre',
  });
  parent.appendChild(el);

  const meter = createFpsMeter();
  let lastRefresh = 0;

  return (renderer) => {
    const now = performance.now();
    const fps = meter.tick(now);
    if (now - lastRefresh < REFRESH_MS) return;
    lastRefresh = now;
    const { calls, triangles } = renderer.info.render;
    const line = extra?.();
    el.textContent = formatStats({ fps, calls, triangles }) + (line ? `\n${line}` : '');
  };
}
