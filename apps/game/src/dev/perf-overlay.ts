import type { WebGLRenderer } from 'three';
import { formatMB } from '../assets/budget.js';
import type { StreamStats } from '../world/streaming/streamer.js';
import { createFpsMeter } from './fps.js';
import { PerfWindow, type PerfSnapshot } from './perf-window.js';

const REFRESH_MS = 250;

interface HeapInfo {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface PerfSources {
  stream: () => StreamStats;
  /** Configured caps (chunks per ring, GPU bytes) for the "x / cap" columns. */
  caps: () => { maxChunks: readonly number[]; gpuBudgetBytes: number };
  /** Extra free-form line (player position, world id). */
  extra?: () => string;
}

/**
 * `?perf=1` overlay (any build, lazy-loaded): fps, frame time, streamed chunks per ring, draw
 * calls, triangles, renderer geometries / textures, JS heap and streamed GPU estimate. The last
 * snapshot is also on `window.__dzPerf` (headless measurements).
 */
export function createPerfOverlay(
  parent: HTMLElement,
  src: PerfSources,
): { frame: (renderer: WebGLRenderer, cpuMs: number) => void; snapshot: () => PerfSnapshot } {
  const el = document.createElement('div');
  el.dataset.perfOverlay = '';
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '8px',
    left: '8px',
    padding: '6px 10px',
    font: '12px/1.45 ui-monospace, monospace',
    color: '#e6e6e6',
    background: 'rgba(0, 0, 0, 0.7)',
    borderRadius: '4px',
    pointerEvents: 'none',
    zIndex: '1001',
    whiteSpace: 'pre',
  });
  parent.appendChild(el);
  const meter = createFpsMeter(120);
  const win = new PerfWindow(120);
  let last: number | undefined;
  let lastRefresh = 0;
  let snap: PerfSnapshot | undefined;

  const frame = (renderer: WebGLRenderer, cpuMs: number): void => {
    const now = performance.now();
    const fps = meter.tick(now);
    if (last !== undefined) win.record(now - last, cpuMs);
    last = now;
    if (now - lastRefresh < REFRESH_MS) return;
    lastRefresh = now;
    const s = src.stream();
    const caps = src.caps();
    const heap = (performance as Performance & { memory?: HeapInfo }).memory;
    const { calls, triangles } = renderer.info.render;
    const { geometries, textures } = renderer.info.memory;
    const w = win.report();
    snap = {
      fps,
      frameMs: w.frameMs,
      frameMaxMs: w.frameMaxMs,
      cpuMs: w.cpuMs,
      calls,
      triangles,
      geometries,
      textures,
      programs: renderer.info.programs?.length ?? 0,
      chunks: s.built,
      wanted: s.wanted,
      pending: s.pending,
      fetching: s.fetching,
      dataChunks: s.dataChunks,
      streamBytes: s.bytes,
      created: s.created,
      disposed: s.disposed,
      heapMB: heap ? heap.usedJSHeapSize / 1048576 : undefined,
    };
    (window as unknown as { __dzPerf?: PerfSnapshot }).__dzPerf = snap;
    const ring = (i: number, name: string) => `${name} ${s.built[i]}/${caps.maxChunks[i]}`;
    el.textContent = [
      `${fps.toFixed(0)} fps · frame ${w.frameMs.toFixed(1)} ms (max ${w.frameMaxMs.toFixed(1)}) · cpu ${w.cpuMs.toFixed(2)} ms · build ${s.buildMs.toFixed(2)} ms`,
      `chunks ${ring(0, 'near')} · ${ring(1, 'mid')} · ${ring(2, 'far')} · pending ${s.pending} · fetch ${s.fetching} · data ${s.dataChunks}`,
      `draw calls ${calls} · tris ${triangles.toLocaleString('en-US')} · geometries ${geometries} · textures ${textures} · programs ${snap.programs}`,
      `stream GPU ${formatMB(s.bytes)} / ${formatMB(caps.gpuBudgetBytes)}${s.overBudget ? ' ⚠' : ''} · JS heap ${heap ? formatMB(heap.usedJSHeapSize) : 'n/a'} · built ${s.created} / freed ${s.disposed}`,
      src.extra?.() ?? '',
    ]
      .filter(Boolean)
      .join('\n');
  };
  return {
    frame,
    snapshot: () =>
      snap ?? {
        fps: 0,
        frameMs: 0,
        frameMaxMs: 0,
        cpuMs: 0,
        calls: 0,
        triangles: 0,
        geometries: 0,
        textures: 0,
        programs: 0,
        chunks: [0, 0, 0],
        wanted: [0, 0, 0],
        pending: 0,
        fetching: 0,
        dataChunks: 0,
        streamBytes: 0,
        created: 0,
        disposed: 0,
        heapMB: undefined,
      },
  };
}
