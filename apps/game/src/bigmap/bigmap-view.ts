import './bigmap.css';
import './floor-panel.css';
import {
  FOG_CHUNK_M,
  LABEL_MIN_ZOOM,
  MARKER_LIMIT,
  OVERVIEW_ZOOM,
  ZOOM_ANIM_MS,
  clampCenter,
  clampZoom,
  cursorText,
  discoveredText,
  distanceText,
  gridBounds,
  gridCell,
  gridCells,
  gridOrigin,
  isDiscovered,
  markerHex,
  minZoomFor,
  CLASSIC_ZOOM_MIN,
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
  type FogGrid as FogGridT,
  type Marker,
  type MarkerDraft,
  type View,
  type Viewport,
} from './bigmap-model.js';
import type { BigMapSource } from './bigmap-source.js';
import { createFooter, createLegend, createNorth, createTopBar } from './bigmap-chrome.js';
import { renderFog } from './fog-render.js';
import {
  PLACE_FONT,
  PLACE_TRACKING,
  boundaryBounds,
  boundarySizeText,
  boundaryTagCorner,
  layoutPlaces,
  rectBoundary,
  type MapBoundary,
  type MapPlace,
  type PlaceTier,
} from './map-features.js';
import { FogMask, OverviewAtlas } from './overview.js';
import type { ChunkData } from '../world/chunk.js';
import { bmIcon, markerGlyph } from './icons.js';
import { createMarkerEdit } from './marker-edit.js';
import { createFloorPanel, floorClick, pickDiscovered, type BigMapFloors } from './floor-panel.js';
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
  /** Whole-map 16 km overview (`?bigmap16=1`); off = classic minimum zoom (`CLASSIC_ZOOM_MIN`). */
  overview?: boolean;
  /** Named places (towns, villages, districts): labelled at every zoom, also over the fog. */
  places?: () => readonly MapPlace[];
  /**
   * Edge of the playable map („GRANICA MAPY”, world metres); default: the sim's chunk bounds.
   * Also the pan limits and the whole-map zoom.
   */
  boundary?: () => MapBoundary | undefined;
  /**
   * Terrain of the far zooms (`overview.ts`): every chunk seen is painted once into a low-res
   * atlas. `loaded` = the synchronous view of the streamed chunks (ground floor); `fetch`
   * (optional) loads a discovered chunk that is not loaded (e.g. after loading a save).
   */
  terrain?: {
    palette: readonly (string | null)[];
    loaded: (cx: number, cy: number) => ChunkData | undefined;
    fetch?: (cx: number, cy: number) => Promise<ChunkData | undefined>;
  };
  /** Building floors (LPM on a building: floor selector and plan); absent = no floor panel. */
  floors?: BigMapFloors;
  /** Sim tick now (floor panel: „widziane 3 h temu”). */
  tick?: () => number;
}

/** Loaded chunks around the player painted into the overview atlas (radius, chunks). */
const ATLAS_RADIUS = 10;
const ATLAS_PUMP_MS = 500;
/** Discovered chunks fetched at once for the atlas while the map is open. */
const ATLAS_FETCHES = 2;
/** Newly painted terrain shows at most this often (painting a save's chunks redraws the map). */
const ATLAS_REDRAW_MS = 250;
const FOG_CSS = 'rgb(92,83,68)';
const PAPER_CSS = 'rgb(230,216,180)';

/** Frame timing of the big map's own drawing (dev perf hook `__dzBigMap`). */
export interface BigMapStats {
  /** Last draw() times (ms), newest last (ring of 240). */
  drawMs: number[];
  frames: number;
  mode: 'far' | 'near';
  atlasChunks: number;
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
  /** Dev / perf: own draw times. */
  stats(): BigMapStats;
  /** Dev / tests: set the view directly (world centre, zoom). */
  setView(center: { x: number; y: number }, zoom: number): void;
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
  const footer = createFooter({ floors: !!o.floors });
  let layers = { ...o.layers };
  let view: View = { center: { x: 0, y: 0 }, zoom: o.zoom };
  let zoomGoal = o.zoom;
  let anim:
    | {
        from: number;
        to: number;
        sx: number;
        sy: number;
        start: number;
        c0: { x: number; y: number };
        home: { x: number; y: number } | undefined;
      }
    | undefined;
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
  let atlas: OverviewAtlas | undefined;
  const fogMask = new FogMask();
  let atlasPumpAt = -Infinity;
  let atlasFetching = 0;
  /** fogVersion · atlas version of the last search that found no discovered chunk to fetch. */
  let fetchIdleKey = '';
  let drawnAtlas = -1;
  let drawnAt = -Infinity;
  const stats: BigMapStats = { drawMs: [], frames: 0, mode: 'near', atlasChunks: 0 };
  let grain: CanvasPattern | null | undefined;
  let hatch: CanvasPattern | null | undefined;

  const vp = (): Viewport => ({
    width: root.clientWidth || 1280,
    height: root.clientHeight || 720,
  });
  const boundary = (): MapBoundary => o.boundary?.() ?? rectBoundary(gridBounds(o.source.fog()));
  /** Smallest zoom: the whole boundary fits the 1280×720 map area (0,1× for 16 km). */
  const minZoom = () =>
    o.overview ? minZoomFor(boundaryBounds(boundary()), vp()) : CLASSIC_ZOOM_MIN;
  /**
   * Pan limits: the boundary's box when the map has one, else the paper map inside the sim's
   * map bounds (or just the bounds).
   */
  const bounds = (): Bounds => {
    if (o.boundary?.()) return boundaryBounds(boundary());
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
    const to = stepZoom(zoomGoal, dir, minZoom());
    if (to === zoomGoal) return;
    zoomGoal = to;
    // Zooming out to the whole map also glides to the map's centre (the square fits whole).
    const b = boundaryBounds(boundary());
    const home =
      to <= minZoom() * 1.0001 ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : undefined;
    anim = { from: view.zoom, to, sx, sy, start: now, c0: { ...view.center }, home };
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

  const floorPanel = o.floors
    ? createFloorPanel({
        floors: o.floors,
        markers: () => o.source.markers(),
        tick: () => o.tick?.() ?? 0,
        location: () => o.info().location,
        onClose: () => root.classList.remove('floors-open'),
      })
    : undefined;
  if (floorPanel) stage.insertBefore(floorPanel.overlay, pins);
  root.append(stage, north, legend, top.el, footer.el, editPanel.el);
  if (floorPanel) root.append(floorPanel.el);
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
    if (!drag) {
      // Pointer cursor only over a building in the discovered part of the map.
      if (o.floors) {
        const w = screenToWorld(view, vp(), cursor.x, cursor.y);
        stage.classList.toggle(
          'dz-bm__stage--building',
          !!pickDiscovered(o.floors, o.source.fog(), w.x, w.y),
        );
      }
      return;
    }
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
  // LPM click (no drag) on a building: its floors (selector + plan) in the panel.
  stage.addEventListener('pointerup', (e) => {
    const click = !!drag && !drag.moved && e.button === 0;
    endDrag();
    if (!click || !o.floors || !floorPanel) return;
    const r = root.getBoundingClientRect();
    const w = screenToWorld(view, vp(), e.clientX - r.left, e.clientY - r.top);
    const hit = floorClick(o.floors, o.source.fog(), w.x, w.y);
    if (hit === 'close') floorPanel.close();
    else if (hit !== 'none') {
      floorPanel.open(hit.open);
      root.classList.add('floors-open');
    }
  });
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => {
    cursor = drag ? cursor : undefined;
    stage.classList.remove('dz-bm__stage--building');
  });
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
    } else if ((e.code === 'PageUp' || e.code === 'PageDown') && floorPanel?.isOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'keydown') floorPanel.step(e.code === 'PageUp' ? 1 : -1);
    } else if (e.code === 'Enter' && e.type === 'keydown' && editPanel.isOpen && !typing) {
      e.preventDefault();
      editPanel.save();
    }
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);

  // --- drawing --------------------------------------------------------------------------
  /** Atlas over the sim's chunk bounds (rebuilt if the bounds change). */
  const ensureAtlas = (): OverviewAtlas | undefined => {
    if (!o.terrain) return undefined;
    const g = o.source.fog();
    const b = atlas?.bounds;
    if (
      !b ||
      b.cx0 !== g.cx0 ||
      b.cy0 !== g.cy0 ||
      b.cx1 !== g.cx0 + g.width - 1 ||
      b.cy1 !== g.cy0 + g.height - 1
    ) {
      atlas = new OverviewAtlas(
        { cx0: g.cx0, cy0: g.cy0, cx1: g.cx0 + g.width - 1, cy1: g.cy0 + g.height - 1 },
        o.terrain.palette,
      );
    }
    return atlas;
  };
  /** Paints the loaded chunks around the player; with the map open also fetches discovered ones. */
  const pumpAtlas = (now: number, p: BigMapPlayer) => {
    if (!o.terrain || now - atlasPumpAt < ATLAS_PUMP_MS) return;
    atlasPumpAt = now;
    const a = ensureAtlas();
    if (!a) return;
    const cx = Math.floor(p.x / FOG_CHUNK_M);
    const cy = Math.floor(p.y / FOG_CHUNK_M);
    const r = ATLAS_RADIUS;
    a.pump({ cx0: cx - r, cy0: cy - r, cx1: cx + r, cy1: cy + r }, o.terrain.loaded);
    const fetch = o.terrain.fetch;
    if (!fetch || root.hidden || atlasFetching >= ATLAS_FETCHES) return;
    const key = `${o.source.fogVersion}`;
    if (key === fetchIdleKey) return;
    const want = a.nextMissing(
      o.source.fog(),
      o.source.fogVersion,
      p.x,
      p.y,
      ATLAS_FETCHES - atlasFetching,
    );
    if (want.length === 0 && atlasFetching === 0) fetchIdleKey = key;
    for (const c of want) {
      atlasFetching++;
      fetch(c.cx, c.cy)
        .then((d) => {
          if (d && atlas === a) a.paint(c.cx, c.cy, d);
          else if (!d) {
            a.unrequest(c.cx, c.cy);
            fetchIdleKey = '';
          }
        })
        .catch(() => {
          a.unrequest(c.cx, c.cy);
          fetchIdleKey = '';
        })
        .finally(() => {
          atlasFetching--;
          atlasPumpAt = -Infinity; // next chunk right away
        });
    }
  };

  const makePatterns = (ctx: CanvasRenderingContext2D) => {
    if (grain !== undefined) return;
    // Paper grain (light / dark specks), drawn over the far-zoom map.
    const g = document.createElement('canvas');
    g.width = g.height = 96;
    const gc = g.getContext('2d');
    if (gc) {
      const img = gc.createImageData(96, 96);
      let s = 987654321;
      for (let i = 0; i < 96 * 96; i++) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        const v = s / 4294967295;
        const light = v > 0.5;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = light ? 255 : 0;
        img.data[i * 4 + 3] = Math.abs(v - 0.5) * 30;
      }
      gc.putImageData(img, 0, 0);
    }
    grain = ctx.createPattern(g, 'repeat');
    // „Poza mapą”: dark diagonal hatch outside the boundary (mockup legend).
    const h = document.createElement('canvas');
    h.width = h.height = 10;
    const hc = h.getContext('2d');
    if (hc) {
      hc.fillStyle = 'rgba(14,17,19,.38)';
      hc.fillRect(0, 0, 10, 10);
      hc.strokeStyle = 'rgba(0,0,0,.45)';
      hc.lineWidth = 2;
      hc.beginPath();
      hc.moveTo(-2, 12);
      hc.lineTo(12, -2);
      hc.moveTo(-2, 2);
      hc.lineTo(2, -2);
      hc.moveTo(8, 12);
      hc.lineTo(12, 8);
      hc.stroke();
    }
    hatch = ctx.createPattern(h, 'repeat');
  };

  /**
   * The map itself for view `vw` in a `v`-sized canvas: paper / terrain, 1 km grid, fog, the
   * boundary and the place names (everything but the grid labels and the trail).
   */
  const paintScene = (
    ctx: CanvasRenderingContext2D,
    vw: View,
    v: Viewport,
    far: boolean,
    busy: boolean,
  ) => {
    const k = ppm(vw.zoom);
    const fogGrid = o.source.fog();
    const gb = gridBounds(fogGrid);
    const a = ensureAtlas();
    // Far zooms: fog outside the sim's map, paper inside it (the mask fogs the undiscovered).
    ctx.fillStyle = far ? FOG_CSS : PAPER_CSS;
    ctx.fillRect(0, 0, v.width, v.height);
    if (far) {
      const g0 = worldToScreen(vw, v, gb.x0, gb.y0);
      ctx.fillStyle = PAPER_CSS;
      ctx.fillRect(g0.x, g0.y, (gb.x1 - gb.x0) * k, (gb.y1 - gb.y0) * k);
    }
    a?.draw(ctx, vw, v, k);
    if (paper && !far) {
      const p = worldToScreen(vw, v, paper.bounds.x0, paper.bounds.y0);
      ctx.imageSmoothingEnabled = vw.zoom * 0.347 < paper.scale * 1.5;
      ctx.drawImage(
        paper.canvas,
        p.x,
        p.y,
        (paper.bounds.x1 - paper.bounds.x0) * k,
        (paper.bounds.y1 - paper.bounds.y0) * k,
      );
    }
    // 1 km grid: faint print on the paper, stronger with SIATKA.
    const org = gridOrigin(fogGrid);
    const w0 = screenToWorld(vw, v, 0, 0);
    const w1 = screenToWorld(vw, v, v.width, v.height);
    const gridLines = (alpha: number, width: number) => {
      ctx.strokeStyle = `rgba(58,48,38,${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let g = Math.ceil((w0.x - org.x) / 1000); g <= Math.floor((w1.x - org.x) / 1000); g++) {
        const s = worldToScreen(vw, v, org.x + g * 1000, 0).x;
        ctx.moveTo(Math.round(s) + 0.5, 0);
        ctx.lineTo(Math.round(s) + 0.5, v.height);
      }
      for (let g = Math.ceil((w0.y - org.y) / 1000); g <= Math.floor((w1.y - org.y) / 1000); g++) {
        const s = worldToScreen(vw, v, 0, org.y + g * 1000).y;
        ctx.moveTo(0, Math.round(s) + 0.5);
        ctx.lineTo(v.width, Math.round(s) + 0.5);
      }
      ctx.stroke();
    };
    if (!far || layers.grid) gridLines(0.16, 1);
    if (far) {
      // Chunk fog mask (1 px per chunk, smoothed) + paper grain: no per-pixel work.
      fogMask.update(fogGrid, o.source.fogVersion);
      fogMask.draw(ctx, fogGrid, vw, v, k);
      if (grain) {
        ctx.fillStyle = grain;
        ctx.fillRect(0, 0, v.width, v.height);
      }
    } else {
      // Fog (soft, torn edge) at 1/2 resolution, 1/4 while panning / zooming.
      const down = busy ? 4 : 2;
      const fog = renderFog(fogGrid, vw, v, down);
      fogCanvas.width = fog.width;
      fogCanvas.height = fog.height;
      fogCanvas
        .getContext('2d')
        ?.putImageData(new ImageData(fog.data, fog.width, fog.height), 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fogCanvas, 0, 0, fog.width * down, fog.height * down);
    }
    if (layers.grid) gridLines(0.42, 1.5);
    drawBoundary(ctx, vw, v);
    drawPlaces(ctx, vw, v, fogGrid);
  };

  /** Far zooms: the whole map pre-painted at one zoom; a frame is one blit (+ trail, labels). */
  let farCache:
    | { canvas: HTMLCanvasElement; zoom: number; x0: number; y0: number; key: string; at: number }
    | undefined;
  const farKey = (v: Viewport) =>
    `${zoomGoal}|${v.width}x${v.height}|${o.source.fogVersion}|${layers.grid}|${boundary()
      .map((q) => `${q.x},${q.y}`)
      .join(';')}|${o.places?.().length ?? 0}`;
  const buildFarCache = (v: Viewport, now: number) => {
    const zoom = zoomGoal;
    const k = ppm(zoom);
    const gb = gridBounds(o.source.fog());
    const bb = boundaryBounds(boundary());
    // The map plus half a screen around it (the pan limit keeps the centre on the map).
    const x0 = Math.min(gb.x0, bb.x0) - v.width / 2 / k;
    const y0 = Math.min(gb.y0, bb.y0) - v.height / 2 / k;
    const x1 = Math.max(gb.x1, bb.x1) + v.width / 2 / k;
    const y1 = Math.max(gb.y1, bb.y1) + v.height / 2 / k;
    const cv: Viewport = { width: Math.ceil((x1 - x0) * k), height: Math.ceil((y1 - y0) * k) };
    const c = farCache?.canvas ?? document.createElement('canvas');
    c.width = cv.width;
    c.height = cv.height;
    const cctx = c.getContext('2d');
    if (!cctx) return;
    const cview: View = { zoom, center: { x: x0 + cv.width / 2 / k, y: y0 + cv.height / 2 / k } };
    paintScene(cctx, cview, cv, true, false);
    farCache = { canvas: c, zoom, x0, y0, key: farKey(v), at: now };
    drawnAtlas = atlas?.version ?? -1;
  };

  const draw = (busy: boolean, now = performance.now()) => {
    const t0 = performance.now();
    const v = vp();
    if (canvas.width !== v.width || canvas.height !== v.height) {
      canvas.width = v.width;
      canvas.height = v.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    makePatterns(ctx);
    const k = ppm(view.zoom);
    const fogGrid = o.source.fog();
    const far = view.zoom < OVERVIEW_ZOOM;
    stats.mode = far ? 'far' : 'near';
    if (far) {
      const stale =
        !farCache ||
        farCache.key !== farKey(v) ||
        (atlas !== undefined && drawnAtlas !== atlas.version && now - farCache.at > 1000);
      // Rebuild when settled (or when there is nothing to scale yet); moving = scale the cache.
      if (stale && (!busy || !farCache || farCache.zoom >= OVERVIEW_ZOOM)) buildFarCache(v, now);
      const fc = farCache!;
      const s = fc.zoom ? view.zoom / fc.zoom : 1;
      const p = worldToScreen(view, v, fc.x0, fc.y0);
      ctx.fillStyle = FOG_CSS;
      ctx.fillRect(0, 0, v.width, v.height);
      ctx.imageSmoothingEnabled = s !== 1;
      ctx.drawImage(
        fc.canvas,
        s === 1 ? Math.round(p.x) : p.x,
        s === 1 ? Math.round(p.y) : p.y,
        fc.canvas.width * s,
        fc.canvas.height * s,
      );
    } else {
      paintScene(ctx, view, v, false, busy);
      drawnAtlas = atlas?.version ?? -1;
    }
    // Grid labels (also visible over the fog).
    const org = gridOrigin(fogGrid);
    const cells = gridCells(fogGrid);
    const w0 = screenToWorld(view, v, 0, 0);
    const w1 = screenToWorld(view, v, v.width, v.height);
    const gx0 = Math.ceil((w0.x - org.x) / 1000);
    const gx1 = Math.floor((w1.x - org.x) / 1000);
    const gy0 = Math.ceil((w0.y - org.y) / 1000);
    const gy1 = Math.floor((w1.y - org.y) / 1000);
    ctx.font = '700 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(228,230,227,.55)';
    const every = k * 1000 < 22 ? 2 : 1;
    for (let g = gx0 - 1; g <= gx1; g++) {
      if (g < 0 || g >= cells.cols || g % every) continue;
      const s = worldToScreen(view, v, org.x + (g + 0.5) * 1000, 0).x;
      if (s > 0 && s < v.width) ctx.fillText(String.fromCharCode(65 + g), s - 4, 70);
    }
    for (let g = gy0 - 1; g <= gy1; g++) {
      if (g < 0 || g >= cells.rows || g % every) continue;
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
    stats.atlasChunks = atlas?.paintedCount ?? 0;
    stats.frames++;
    stats.drawMs.push(performance.now() - t0);
    if (stats.drawMs.length > 240) stats.drawMs.shift();
  };

  /** „GRANICA MAPY”: hatch outside, gold 2 px frame (dark outline), tag at the SW corner. */
  const drawBoundary = (ctx: CanvasRenderingContext2D, vw: View, v: Viewport) => {
    const poly = boundary().map((q) => worldToScreen(vw, v, q.x, q.y));
    if (poly.length < 3) return;
    const path = () => {
      ctx.beginPath();
      poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
    };
    if (hatch) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-10, -10, v.width + 20, v.height + 20);
      poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = hatch;
      ctx.fill('evenodd');
      ctx.restore();
    }
    ctx.lineJoin = 'miter';
    path();
    ctx.strokeStyle = 'rgba(14,17,19,.8)';
    ctx.lineWidth = 4;
    ctx.stroke();
    path();
    ctx.strokeStyle = '#E0A23A';
    ctx.lineWidth = 2;
    ctx.stroke();
    const c = boundaryTagCorner(boundary());
    if (!c) return;
    const s = worldToScreen(vw, v, c.x, c.y);
    const text = `GRANICA MAPY · ${boundarySizeText(boundary())}`;
    ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
    const w = Math.ceil(ctx.measureText(text).width) + 14;
    const h = 19;
    // Left of the corner, just above it (mockup); kept on screen while the corner is near.
    const x = Math.min(v.width - w - 8, Math.max(8, s.x - 8 - w));
    const y = Math.min(v.height - 46 - h, Math.max(60, s.y - 6 - h));
    if (Math.abs(x + w - (s.x - 8)) > 240 || Math.abs(y + h - (s.y - 6)) > 160) return;
    ctx.fillStyle = 'rgba(21,25,28,.88)';
    ctx.strokeStyle = '#C78B2A';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#F0C06A';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 7.5, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  };

  const placeWidths = new Map<string, number>();
  const setFont = (ctx: CanvasRenderingContext2D, tier: PlaceTier) => {
    ctx.font = PLACE_FONT[tier];
    ctx.letterSpacing = `${PLACE_TRACKING[tier]}px`;
  };
  const drawPlaces = (ctx: CanvasRenderingContext2D, vw: View, v: Viewport, fog: FogGridT) => {
    const places = o.places?.() ?? [];
    if (places.length === 0) return;
    const labels = layoutPlaces(
      places,
      vw.zoom,
      (x, y) => worldToScreen(vw, v, x, y),
      (text, tier) => {
        const key = `${tier}|${text}`;
        let w = placeWidths.get(key);
        if (w === undefined) {
          setFont(ctx, tier);
          w = ctx.measureText(text).width;
          placeWidths.set(key, w);
        }
        return w;
      },
      v,
    );
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of labels) {
      const onPaper = isDiscovered(
        fog,
        Math.floor(l.place.x / FOG_CHUNK_M),
        Math.floor(l.place.y / FOG_CHUNK_M),
      );
      setFont(ctx, l.tier);
      // On paper: dark ink with a paper halo; over the fog: light ink with a dark halo.
      ctx.strokeStyle = onPaper ? 'rgba(236,226,200,.92)' : 'rgba(14,12,9,.75)';
      ctx.lineWidth = l.tier === 'town' ? 5 : 3.5;
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = onPaper
        ? l.tier === 'town'
          ? '#2b241c'
          : l.tier === 'village'
            ? '#2f281f'
            : '#3d3428'
        : l.tier === 'town'
          ? 'rgba(236,226,200,.95)'
          : 'rgba(214,204,182,.85)';
      ctx.fillText(l.text, l.x, l.y);
      if (l.tier === 'town') {
        ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
        ctx.letterSpacing = '0.6px';
        const t = 'miasto';
        const tw = ctx.measureText(t).width + 12;
        const py = l.y + 20;
        ctx.fillStyle = onPaper ? 'rgba(236,226,200,.88)' : 'rgba(21,25,28,.85)';
        ctx.beginPath();
        ctx.roundRect(l.x - tw / 2, py - 7.5, tw, 15, 3);
        ctx.fill();
        ctx.fillStyle = onPaper ? '#4a3f33' : 'rgba(214,204,182,.9)';
        ctx.fillText(t, l.x, py + 0.5);
      }
    }
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
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
      zoomGoal = clampZoom(zoomGoal, minZoom());
      view = { zoom: zoomGoal, center: { x: p.x, y: p.y } };
      setView(view);
      o.root.dataset.modal = 'map';
      o.onOpenChange?.(true);
    },
    hide() {
      if (root.hidden) return;
      closeEdit();
      floorPanel?.close();
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
      else if (floorPanel?.isOpen) floorPanel.close();
      else api.hide();
    },
    frame(now, p) {
      pumpAtlas(now, p);
      if (root.hidden) return;
      player = p;
      let busy = !!drag;
      if (anim) {
        const t = Math.min(1, (now - anim.start) / ZOOM_ANIM_MS);
        const e = 1 - (1 - t) ** 3;
        const z = zoomAround(view, vp(), anim.sx, anim.sy, anim.from + (anim.to - anim.from) * e);
        if (anim.home) {
          z.center = {
            x: anim.c0.x + (anim.home.x - anim.c0.x) * e,
            y: anim.c0.y + (anim.home.y - anim.c0.y) * e,
          };
        }
        setView(z);
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
      if (
        dirty ||
        drawnFog !== o.source.fogVersion ||
        drawnTrail !== o.source.trailVersion ||
        (atlas && drawnAtlas !== atlas.version && !busy && now - drawnAt > ATLAS_REDRAW_MS)
      ) {
        drawnAt = now;
        draw(busy, now);
        dirty = busy; // redraw sharp once the motion stops
      }
      layoutPins();
      placeTemp();
      const v = vp();
      floorPanel?.frame(view, v);
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
    stats: () => stats,
    setView(center, zoom) {
      anim = undefined;
      inertia = undefined;
      zoomGoal = clampZoom(zoom, minZoom());
      setView({ center, zoom: zoomGoal });
    },
  };
  return api;
}
