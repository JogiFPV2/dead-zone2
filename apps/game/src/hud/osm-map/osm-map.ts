import './osm-map.css';
import { lonLatToTile, type LonLat } from './osm-geo.js';

/**
 * Second HUD map (Ustawienia › Interfejs › Mapa OpenStreetMap): a north-up rectangle of live
 * tile.openstreetmap.org tiles with the player's arrow in the middle. The box size comes from the
 * HUD editor (layout `w` / `h`), zoom from −/+ and the wheel.
 *
 * OSMF tile usage policy (operations.osmfoundation.org/policies/tiles): visible „© OpenStreetMap”
 * attribution linking to the copyright page, the standard tile URL, browser caching left alone,
 * only the tiles in view are requested (no prefetch), the page's Referer is sent.
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org';
export const OSM_ZOOM_MIN = 10;
export const OSM_ZOOM_MAX = 19;
export const OSM_ZOOM_DEFAULT = 16;
const TILE = 256;

export interface OsmMapOptions {
  zoom?: number;
  /** New zoom (persist). */
  onZoom?: (zoom: number) => void;
  /** Tile URL root (tests). */
  tileUrl?: string;
}

export interface OsmMap {
  readonly el: HTMLElement;
  /** Player position (undefined: the map has no place on Earth) and heading (sim radians). */
  update(pos: LonLat | undefined, heading: number): void;
  setZoom(z: number): void;
  readonly zoom: number;
}

export const clampOsmZoom = (z: number): number =>
  Math.min(
    OSM_ZOOM_MAX,
    Math.max(OSM_ZOOM_MIN, Math.round(Number.isFinite(z) ? z : OSM_ZOOM_DEFAULT)),
  );

/** Tiles covering a `w`×`h` px box centred on tile point (cx, cy) at zoom `z` (no wrap needed here). */
export function tilesInView(
  cx: number,
  cy: number,
  z: number,
  w: number,
  h: number,
): { x: number; y: number }[] {
  const n = 2 ** z;
  const x0 = Math.floor(cx - w / 2 / TILE);
  const x1 = Math.floor(cx + w / 2 / TILE);
  const y0 = Math.max(0, Math.floor(cy - h / 2 / TILE));
  const y1 = Math.min(n - 1, Math.floor(cy + h / 2 / TILE));
  const out: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

export function createOsmMap(o: OsmMapOptions = {}): OsmMap {
  const root = o.tileUrl ?? OSM_TILE_URL;
  let zoom = clampOsmZoom(o.zoom ?? OSM_ZOOM_DEFAULT);
  const el = document.createElement('div');
  el.className = 'dz-osm dz-glass';
  el.innerHTML = `<div class="dz-osm__tiles"></div><svg class="dz-osm__me" viewBox="-12 -12 24 24" aria-hidden="true"><circle r="10" class="dz-osm__halo"/><path d="M0 -9 L6.5 7 L0 3.5 L-6.5 7 Z" class="dz-osm__arrow"/></svg><div class="dz-osm__off" hidden>Mapa OpenStreetMap działa tylko na mapie Stalowej Woli (stw2).</div><div class="dz-osm__zoom"><button type="button" class="dz-mmzoom__btn" data-z="-1" title="Oddal mapę OSM" aria-label="Oddal mapę OSM">−</button><button type="button" class="dz-mmzoom__btn" data-z="1" title="Przybliż mapę OSM" aria-label="Przybliż mapę OSM">+</button></div><a class="dz-osm__attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>`;
  el.setAttribute('aria-label', 'Mapa OpenStreetMap');
  const tilesEl = el.querySelector<HTMLElement>('.dz-osm__tiles')!;
  const me = el.querySelector<SVGElement>('.dz-osm__me')!;
  const off = el.querySelector<HTMLElement>('.dz-osm__off')!;
  const minus = el.querySelector<HTMLButtonElement>('[data-z="-1"]')!;
  const plus = el.querySelector<HTMLButtonElement>('[data-z="1"]')!;
  const tiles = new Map<string, HTMLImageElement>();
  let last: { pos: LonLat | undefined; heading: number } = { pos: undefined, heading: 0 };
  let size = { w: 0, h: 0 };
  let drawnKey = '';

  const syncButtons = (): void => {
    minus.disabled = zoom <= OSM_ZOOM_MIN;
    plus.disabled = zoom >= OSM_ZOOM_MAX;
  };

  function draw(): void {
    const { pos, heading } = last;
    off.hidden = pos !== undefined;
    me.style.display = pos ? '' : 'none';
    me.style.transform = `translate(-50%, -50%) rotate(${((heading + Math.PI / 2) * 180) / Math.PI}deg)`;
    if (!pos || size.w <= 0 || size.h <= 0) {
      for (const img of tiles.values()) img.remove();
      tiles.clear();
      drawnKey = '';
      return;
    }
    const t = lonLatToTile(pos, zoom);
    // Redraw only when the map moved by at least ¼ px (the HUD ticks at 10 Hz).
    const key = `${zoom}:${Math.round(t.x * TILE * 4)}:${Math.round(t.y * TILE * 4)}:${size.w}x${size.h}`;
    if (key === drawnKey) return;
    drawnKey = key;
    const want = new Set<string>();
    const ox = size.w / 2 - t.x * TILE;
    const oy = size.h / 2 - t.y * TILE;
    for (const { x, y } of tilesInView(t.x, t.y, zoom, size.w, size.h)) {
      const id = `${zoom}/${x}/${y}`;
      want.add(id);
      let img = tiles.get(id);
      if (!img) {
        img = document.createElement('img');
        img.className = 'dz-osm__tile';
        img.alt = '';
        img.draggable = false;
        img.decoding = 'async';
        img.addEventListener('error', () => img?.setAttribute('data-err', ''));
        img.src = `${root}/${id}.png`;
        tiles.set(id, img);
        tilesEl.append(img);
      }
      img.style.transform = `translate(${Math.round(ox + x * TILE)}px, ${Math.round(oy + y * TILE)}px)`;
    }
    for (const [id, img] of tiles) {
      if (want.has(id)) continue;
      img.remove();
      tiles.delete(id);
    }
  }

  function setZoom(z: number, notify = false): void {
    const next = clampOsmZoom(z);
    if (next === zoom) return;
    zoom = next;
    syncButtons();
    draw();
    if (notify) o.onZoom?.(zoom);
  }

  const zoomBox = el.querySelector<HTMLElement>('.dz-osm__zoom')!;
  zoomBox.addEventListener('pointerdown', (e) => e.stopPropagation());
  zoomBox.addEventListener('click', (e) => {
    e.stopPropagation();
    const d = Number((e.target as HTMLElement).closest<HTMLElement>('[data-z]')?.dataset.z);
    if (d) setZoom(zoom + d, true);
  });
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY) setZoom(zoom + (e.deltaY < 0 ? 1 : -1), true);
    },
    { passive: false },
  );

  const measure = (): void => {
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === size.w && h === size.h) return;
    size = { w, h };
    draw();
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(el);
  syncButtons();

  return {
    el,
    get zoom() {
      return zoom;
    },
    setZoom: (z) => setZoom(z),
    update(pos, heading) {
      last = { pos, heading };
      if (size.w === 0) measure();
      draw();
    },
  };
}
