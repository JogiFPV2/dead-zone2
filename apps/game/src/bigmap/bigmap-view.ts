import './bigmap.css';
import {
  LABEL_MIN_ZOOM,
  MARKER_LIMIT,
  ZOOM_ANIM_MS,
  clampCenter,
  cursorText,
  discoveredText,
  distanceText,
  gridBounds,
  gridCell,
  gridCells,
  gridOrigin,
  markerHex,
  metres,
  panelPosition,
  placeLabels,
  ppm,
  scaleBar,
  screenToWorld,
  stepZoom,
  trailSegments,
  worldToScreen,
  zoomAround,
  zoomText,
  type BigMapLayers,
  type Bounds,
  type Marker,
  type MarkerDraft,
  type View,
  type Viewport,
} from './bigmap-model.js';
import type { BigMapSource } from './bigmap-source.js';
import { createFooter, createLegend, createNorth, createTopBar } from './bigmap-chrome.js';
import { renderFog } from './fog-render.js';
import { bmIcon, markerGlyph } from './icons.js';
import { createMarkerEdit } from './marker-edit.js';
import type { PaperMap } from './paper.js';

export interface BigMapOptions {
  root: HTMLElement;
  source: BigMapSource;
  /** Paper map of the loaded world (built lazily on first open). */
  paper: () => PaperMap;
  zoom: number;
  layers: BigMapLayers;
  onView: (zoom: number, layers: BigMapLayers) => void;
  /** Top bar subtitle data. */
  info: () => { day: number | undefined; minuteOfDay: number | undefined; location: string };
  onOpenChange?: (open: boolean) => void;
  /** Short message (marker limit, outside the map). */
  toast?: (text: string) => void;
}

export interface BigMapPlayer {
  x: number;
  y: number;
  /** Sim facing (radians from +x towards +y). */
  heading: number;
}

export interface BigMap {
  readonly el: HTMLElement;
  readonly open: boolean;
  show(player: BigMapPlayer): void;
  hide(): void;
  toggle(player: BigMapPlayer): void;
  /** Esc: closes the edit panel first, then the map. */
  escape(): void;
  frame(now: number, player: BigMapPlayer): void;
}

const INERTIA_MS = 200;
const DELETE_HOLD_MS = 500;
const LABEL_FONT = '600 11px "JetBrains Mono", ui-monospace, monospace';

const div = (cls: string, html = '') => {
  const e = document.createElement('div');
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** Big map screen (deadzone-hud-v2-spec §11). The world keeps running while it is open. */
export function createBigMap(o: BigMapOptions): BigMap {
  const root = div('dz-bm');
  root.hidden = true;
  const stage = div('dz-bm__stage');
  const canvas = document.createElement('canvas');
  canvas.className = 'dz-bm__canvas';
  const edge = div('dz-bm__edge');
  const pins = div('dz-bm__pins');
  const playerEl = div(
    'dz-bm__player',
    '<div class="dz-bm__glow"></div><svg class="dz-bm__arrow" width="28" height="28" viewBox="0 0 28 28"><path d="M14 2L24 25 14 19 4 25z" fill="#E0A23A" stroke="#0E1113" stroke-width="2" stroke-linejoin="round"/></svg><div class="dz-bm__tag dz-bm__tag--you">TY</div>',
  );
  const temp = div('dz-bm__temp');
  const dim = div('dz-bm__dim');
  stage.append(canvas, edge, pins, playerEl, dim, temp);
  const north = createNorth();
  const legend = createLegend();
  const footer = createFooter();
  let layers = { ...o.layers };
  let view: View = { center: { x: 0, y: 0 }, zoom: o.zoom };
  let zoomGoal = o.zoom;
  let anim: { from: number; to: number; sx: number; sy: number; start: number } | undefined;
  let drag: { x: number; y: number; t: number; vx: number; vy: number; moved: boolean } | undefined;
  let inertia: { vx: number; vy: number; start: number; last: number } | undefined;
  let cursor: { x: number; y: number } | undefined;
  let hover: number | undefined;
  let delHold: { id: number; start: number } | undefined;
  let edit: { mode: 'new' | 'edit'; id?: number; x: number; y: number } | undefined;
  let lastDraft: Pick<MarkerDraft, 'icon' | 'color'> = {
    icon: 'base:marker-base',
    color: 'yellow',
  };
  let paper: PaperMap | undefined;
  let player: BigMapPlayer = { x: 0, y: 0, heading: 0 };
  let dirty = true;
  let drawnFog = -1;
  let drawnTrail = -1;
  let pinsFor: readonly Marker[] | undefined;
  let pinsKey = '';
  const fogCanvas = document.createElement('canvas');

  const vp = (): Viewport => ({
    width: root.clientWidth || 1280,
    height: root.clientHeight || 720,
  });
  /** Pan limits: the paper map inside the sim's map bounds (or just the bounds). */
  const bounds = (): Bounds => {
    const g = gridBounds(o.source.fog());
    const b = paper?.bounds;
    return b
      ? {
          x0: Math.max(g.x0, b.x0),
          y0: Math.max(g.y0, b.y0),
          x1: Math.min(g.x1, b.x1),
          y1: Math.min(g.y1, b.y1),
        }
      : g;
  };
  const setView = (v: View) => {
    view = { zoom: v.zoom, center: clampCenter(v.center, bounds()) };
    dirty = true;
  };
  const save = () => o.onView(zoomGoal, layers);

  const zoomTo = (dir: number, sx: number, sy: number, now = performance.now()) => {
    const to = stepZoom(zoomGoal, dir);
    if (to === zoomGoal) return;
    zoomGoal = to;
    anim = { from: view.zoom, to, sx, sy, start: now };
    save();
  };
  const centerOnPlayer = () => {
    inertia = undefined;
    setView({ ...view, center: { x: player.x, y: player.y } });
  };

  const top = createTopBar({
    zoom: (dir) => zoomTo(dir, vp().width / 2, vp().height / 2),
    center: centerOnPlayer,
    layer: (k) => {
      layers = { ...layers, [k]: !layers[k] };
      dirty = true;
      pinsKey = '';
      save();
    },
    close: () => api.hide(),
  });

  const markerInfo = (x: number, y: number) =>
    `${gridCell(o.source.fog(), x, y)} · x ${metres(x - gridOrigin(o.source.fog()).x)} · y ${metres(y - gridOrigin(o.source.fog()).y)} m · ${distanceText(Math.hypot(x - player.x, y - player.y))} od gracza`;

  const editPanel = createMarkerEdit({
    save(d) {
      if (!edit) return;
      if (edit.mode === 'new') o.source.addMarker({ ...d, x: edit.x, y: edit.y });
      else if (edit.id !== undefined) o.source.editMarker(edit.id, { ...d, x: edit.x, y: edit.y });
      lastDraft = { icon: d.icon, color: d.color };
      closeEdit();
    },
    remove() {
      if (edit?.mode === 'edit' && edit.id !== undefined) o.source.removeMarker(edit.id);
      closeEdit();
    },
    cancel: () => closeEdit(),
  });
  editPanel.onChange = () => {
    dirty = true;
    pinsKey = '';
  };
  const openEdit = (mode: 'new' | 'edit', x: number, y: number, m?: Marker) => {
    edit = { mode, x, y, ...(m ? { id: m.id } : {}) };
    editPanel.open({
      mode,
      draft: m ?? { x, y, ...lastDraft, text: '', showOnMinimap: true },
      info: markerInfo(x, y),
    });
    root.classList.add('editing');
    pinsKey = '';
    dirty = true;
  };
  const closeEdit = () => {
    edit = undefined;
    editPanel.close();
    root.classList.remove('editing');
    pinsKey = '';
    dirty = true;
  };

  root.append(stage, north, legend, top.el, footer.el, editPanel.el);
  o.root.append(root);

  // --- pointer: pan with inertia, wheel zoom around the cursor, RMB new marker -------------
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || editPanel.isOpen) {
      if (editPanel.isOpen && e.button === 0) closeEdit();
      return;
    }
    inertia = undefined;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: false };
    stage.setPointerCapture?.(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    const r = root.getBoundingClientRect();
    cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (!drag) return;
    const now = performance.now();
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const dt = Math.max(1, now - drag.t);
    drag.vx = dx / dt;
    drag.vy = dy / dt;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = now;
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 0;
    const k = ppm(view.zoom);
    setView({ ...view, center: { x: view.center.x - dx / k, y: view.center.y - dy / k } });
  });
  const endDrag = () => {
    if (!drag) return;
    if (performance.now() - drag.t < 60 && (drag.vx || drag.vy)) {
      const now = performance.now();
      inertia = { vx: drag.vx, vy: drag.vy, start: now, last: now };
    }
    drag = undefined;
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => (cursor = drag ? cursor : undefined));
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = root.getBoundingClientRect();
      zoomTo(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (editPanel.isOpen) closeEdit();
    if (o.source.markers().length >= MARKER_LIMIT) {
      o.toast?.(`Limit znaczników (${MARKER_LIMIT})`);
      return;
    }
    const r = root.getBoundingClientRect();
    const w = screenToWorld(view, vp(), e.clientX - r.left, e.clientY - r.top);
    // The sim rejects markers outside its map bounds (`invalid-target`): say so right away.
    const g = gridBounds(o.source.fog());
    if (w.x < g.x0 || w.y < g.y0 || w.x >= g.x1 || w.y >= g.y1) {
      o.toast?.('Poza mapą');
      return;
    }
    openEdit('new', w.x, w.y);
  });
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- keys (capture, so Space / Delete do not reach the game while the map is open) -------
  const onKey = (e: KeyboardEvent) => {
    if (root.hidden) return;
    const typing = e.target instanceof HTMLInputElement && e.target.type === 'text';
    if (e.code === 'Space' && !typing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'keydown') centerOnPlayer();
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && !typing) {
      e.stopImmediatePropagation();
      if (e.type === 'keydown' && hover !== undefined && !delHold) {
        delHold = { id: hover, start: performance.now() };
      } else if (e.type === 'keyup') delHold = undefined;
    } else if (e.code === 'Enter' && e.type === 'keydown' && editPanel.isOpen && !typing) {
      e.preventDefault();
      editPanel.save();
    }
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);

  // --- drawing --------------------------------------------------------------------------
  const draw = (busy: boolean) => {
    const v = vp();
    if (canvas.width !== v.width || canvas.height !== v.height) {
      canvas.width = v.width;
      canvas.height = v.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const k = ppm(view.zoom);
    ctx.fillStyle = 'rgb(230,216,180)';
    ctx.fillRect(0, 0, v.width, v.height);
    if (paper) {
      const p = worldToScreen(view, v, paper.bounds.x0, paper.bounds.y0);
      ctx.imageSmoothingEnabled = view.zoom * 0.347 < paper.scale * 1.5;
      ctx.drawImage(
        paper.canvas,
        p.x,
        p.y,
        (paper.bounds.x1 - paper.bounds.x0) * k,
        (paper.bounds.y1 - paper.bounds.y0) * k,
      );
    }
    // 1 km grid: faint print on the paper, stronger with SIATKA.
    const fogGrid = o.source.fog();
    const org = gridOrigin(fogGrid);
    const cells = gridCells(fogGrid);
    const w0 = screenToWorld(view, v, 0, 0);
    const w1 = screenToWorld(view, v, v.width, v.height);
    const gx0 = Math.ceil((w0.x - org.x) / 1000);
    const gx1 = Math.floor((w1.x - org.x) / 1000);
    const gy0 = Math.ceil((w0.y - org.y) / 1000);
    const gy1 = Math.floor((w1.y - org.y) / 1000);
    const gridLines = (alpha: number, width: number) => {
      ctx.strokeStyle = `rgba(58,48,38,${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let g = gx0; g <= gx1; g++) {
        const s = worldToScreen(view, v, org.x + g * 1000, 0).x;
        ctx.moveTo(Math.round(s) + 0.5, 0);
        ctx.lineTo(Math.round(s) + 0.5, v.height);
      }
      for (let g = gy0; g <= gy1; g++) {
        const s = worldToScreen(view, v, 0, org.y + g * 1000).y;
        ctx.moveTo(0, Math.round(s) + 0.5);
        ctx.lineTo(v.width, Math.round(s) + 0.5);
      }
      ctx.stroke();
    };
    gridLines(0.16, 1);
    // Fog (soft, torn edge) at 1/2 resolution, 1/4 while panning / zooming.
    const down = busy ? 4 : 2;
    const fog = renderFog(fogGrid, view, v, down);
    fogCanvas.width = fog.width;
    fogCanvas.height = fog.height;
    fogCanvas.getContext('2d')?.putImageData(new ImageData(fog.data, fog.width, fog.height), 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fogCanvas, 0, 0, fog.width * down, fog.height * down);
    if (layers.grid) gridLines(0.42, 1.5);
    // Grid labels (also visible over the fog).
    ctx.font = '700 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(228,230,227,.55)';
    for (let g = gx0 - 1; g <= gx1; g++) {
      if (g < 0 || g >= cells.cols) continue;
      const s = worldToScreen(view, v, org.x + (g + 0.5) * 1000, 0).x;
      if (s > 0 && s < v.width) ctx.fillText(String.fromCharCode(65 + g), s - 4, 70);
    }
    for (let g = gy0 - 1; g <= gy1; g++) {
      if (g < 0 || g >= cells.rows) continue;
      const s = worldToScreen(view, v, 0, org.y + (g + 0.5) * 1000).y;
      if (s > 60 && s < v.height - 40) ctx.fillText(String(g + 1), 8, s + 4);
    }
    // Trail: dashed #A01E16 4 px (11 / 7 screen px), light paper outline 7 px.
    if (layers.trail) {
      const segs = trailSegments(o.source.trail());
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const pass of [0, 1]) {
        ctx.setLineDash(pass ? [11, 7] : []);
        ctx.strokeStyle = pass ? '#A01E16' : 'rgba(240,229,203,.7)';
        ctx.lineWidth = pass ? 4 : 7;
        ctx.lineCap = pass ? 'butt' : 'round';
        for (const seg of segs) {
          ctx.beginPath();
          seg.forEach((p, i) => {
            const s = worldToScreen(view, v, p.x, p.y);
            if (i) ctx.lineTo(s.x, s.y);
            else ctx.moveTo(s.x, s.y);
          });
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
    drawnFog = o.source.fogVersion;
    drawnTrail = o.source.trailVersion;
  };

  const measure = document.createElement('canvas').getContext('2d');
  const labelWidth = (t: string) => {
    if (!measure) return t.length * 7 + 17;
    measure.font = LABEL_FONT;
    return Math.ceil(measure.measureText(t).width) + 17;
  };

  const pinHtml = (m: Pick<Marker, 'icon' | 'color'>) =>
    `<div class="dz-bm__pin" style="--c:${markerHex(m.color)}">${bmIcon(markerGlyph(m.icon), markerHex(m.color), 17, 2)}</div>`;

  const layoutPins = () => {
    const v = vp();
    const list = layers.markers ? o.source.markers() : [];
    const key = `${view.zoom}|${view.center.x}|${view.center.y}|${v.width}|${v.height}|${hover}|${edit?.id}`;
    if (list === pinsFor && key === pinsKey) return;
    pinsFor = list;
    pinsKey = key;
    pins.innerHTML = '';
    const shown = list.filter((m) => m.id !== edit?.id);
    const pts = shown.map((m) => {
      const s = worldToScreen(view, v, m.x, m.y);
      return { x: s.x, y: s.y, w: m.text ? labelWidth(m.text) : 0, h: 23 };
    });
    const sides = placeLabels(pts);
    const labels = view.zoom >= LABEL_MIN_ZOOM;
    shown.forEach((m, i) => {
      const p = pts[i]!;
      if (p.x < -40 || p.y < -40 || p.x > v.width + 40 || p.y > v.height + 40) return;
      const wrap = div('dz-bm__mark');
      wrap.style.left = `${p.x}px`;
      wrap.style.top = `${p.y}px`;
      wrap.innerHTML = pinHtml(m);
      wrap.title = m.text;
      if (delHold?.id === m.id) wrap.classList.add('deleting');
      if (labels && m.text) {
        const tag = div(`dz-bm__tag dz-bm__tag--${sides[i]}`);
        tag.textContent = m.text;
        tag.style.borderLeftColor = markerHex(m.color);
        wrap.append(tag);
      }
      const pin = wrap.firstElementChild as HTMLElement;
      pin.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        openEdit('edit', m.x, m.y, m);
      });
      pin.addEventListener('pointerenter', () => (hover = m.id));
      pin.addEventListener('pointerleave', () => {
        if (hover === m.id) hover = undefined;
      });
      pins.append(wrap);
    });
  };

  const placeTemp = () => {
    const d = editPanel.draft;
    if (!edit || !d) {
      temp.hidden = true;
      return;
    }
    const v = vp();
    const s = worldToScreen(view, v, edit.x, edit.y);
    temp.hidden = false;
    temp.style.left = `${s.x}px`;
    temp.style.top = `${s.y}px`;
    temp.innerHTML = `<div class="dz-bm__ring"></div>${pinHtml(d)}`;
    const w = editPanel.el.offsetWidth || 318;
    const h = editPanel.el.offsetHeight || 336;
    const pos = panelPosition(s.x, s.y, w, h, v);
    editPanel.place(pos.x, pos.y);
    temp.classList.toggle('flipped', pos.flipped);
  };

  const api: BigMap = {
    el: root,
    get open() {
      return !root.hidden;
    },
    show(p) {
      if (!root.hidden) return;
      paper ??= o.paper();
      player = p;
      root.hidden = false;
      view = { zoom: zoomGoal, center: { x: p.x, y: p.y } };
      setView(view);
      o.root.dataset.modal = 'map';
      o.onOpenChange?.(true);
    },
    hide() {
      if (root.hidden) return;
      closeEdit();
      root.hidden = true;
      drag = undefined;
      inertia = undefined;
      delHold = undefined;
      if (o.root.dataset.modal === 'map') o.root.dataset.modal = '';
      o.onOpenChange?.(false);
    },
    toggle(p) {
      if (root.hidden) api.show(p);
      else api.hide();
    },
    escape() {
      if (editPanel.isOpen) closeEdit();
      else api.hide();
    },
    frame(now, p) {
      if (root.hidden) return;
      player = p;
      let busy = !!drag;
      if (anim) {
        const t = Math.min(1, (now - anim.start) / ZOOM_ANIM_MS);
        const e = 1 - (1 - t) ** 3;
        setView(zoomAround(view, vp(), anim.sx, anim.sy, anim.from + (anim.to - anim.from) * e));
        if (t >= 1) anim = undefined;
        busy = true;
      }
      if (inertia) {
        const t = (now - inertia.start) / INERTIA_MS;
        if (t >= 1) inertia = undefined;
        else {
          const dt = now - inertia.last;
          inertia.last = now;
          const f = 1 - t;
          const k = ppm(view.zoom);
          setView({
            ...view,
            center: {
              x: view.center.x - (inertia.vx * dt * f) / k,
              y: view.center.y - (inertia.vy * dt * f) / k,
            },
          });
          busy = true;
        }
      }
      if (delHold && now - delHold.start >= DELETE_HOLD_MS) {
        o.source.removeMarker(delHold.id);
        delHold = undefined;
        hover = undefined;
      }
      if (dirty || drawnFog !== o.source.fogVersion || drawnTrail !== o.source.trailVersion) {
        draw(busy);
        dirty = busy; // redraw sharp once the motion stops
      }
      layoutPins();
      placeTemp();
      const v = vp();
      const ps = worldToScreen(view, v, p.x, p.y);
      playerEl.style.transform = `translate(${ps.x}px, ${ps.y}px)`;
      playerEl
        .querySelector<SVGElement>('.dz-bm__arrow')
        ?.style.setProperty(
          'transform',
          `rotate(${((p.heading * 180) / Math.PI + 90).toFixed(0)}deg)`,
        );
      const info = o.info();
      const hh =
        info.minuteOfDay === undefined ? undefined : Math.floor(info.minuteOfDay / 60) % 24;
      const mm = info.minuteOfDay === undefined ? undefined : Math.floor(info.minuteOfDay % 60);
      const time =
        hh === undefined ? '' : ` · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      top.update({
        subtitle: `Dzień ${info.day ?? 1}${time} · ${info.location}, kratka ${gridCell(o.source.fog(), p.x, p.y)}`,
        zoom: zoomText(zoomGoal),
        layers,
        markers: o.source.markers().length,
        scale: scaleBar(view.zoom),
      });
      const cw = cursor ? screenToWorld(view, v, cursor.x, cursor.y) : { x: p.x, y: p.y };
      footer.update(cursorText(o.source.fog(), cw.x, cw.y), discoveredText(o.source.fog()));
    },
  };
  return api;
}
