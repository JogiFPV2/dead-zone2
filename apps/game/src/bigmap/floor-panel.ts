import {
  stairTiles,
  roomLabel,
  type Box,
  type BuildingPlan,
  type FloorPlan,
} from '../floors/building-plan.js';
import type { FloorIntel } from '../floors/floor-intel.js';
import {
  buildingTag,
  floorName,
  floorShort,
  stairwellsChip,
  storeysChip,
} from '../floors/floor-names.js';
import { agoText, floorStats, inBox, planScale, zombiesOnFloor } from '../floors/floor-stats.js';
import {
  fogChunk,
  isDiscovered,
  markerHex,
  worldToScreen,
  type FogGrid,
  type Marker,
  type View,
  type Viewport,
} from './bigmap-model.js';
import { bmIcon, markerGlyph } from './icons.js';

/** What the big map needs for building floors (floors-controller.ts). */
export interface BigMapFloors {
  readonly intel: FloorIntel;
  pick(x: number, y: number): BuildingPlan | undefined;
  current(): { plan: BuildingPlan; z: number } | undefined;
}

/**
 * Building under world point (x, y) for the big map, only in the discovered part of the map:
 * the chunk under the point must be discovered (fog bitmap). In the fog a click does nothing
 * and the cursor stays the drag hand.
 */
export function pickDiscovered(
  floors: Pick<BigMapFloors, 'pick'>,
  fog: FogGrid,
  x: number,
  y: number,
): BuildingPlan | undefined {
  const c = fogChunk(x, y);
  return isDiscovered(fog, c.cx, c.cy) ? floors.pick(x, y) : undefined;
}

/**
 * LPM click (no drag) on the big map at world (x, y): a building in the discovered part opens
 * its panel, empty discovered ground closes the panel, a click in the fog does nothing.
 */
export function floorClick(
  floors: Pick<BigMapFloors, 'pick'>,
  fog: FogGrid,
  x: number,
  y: number,
): { open: BuildingPlan } | 'close' | 'none' {
  const c = fogChunk(x, y);
  if (!isDiscovered(fog, c.cx, c.cy)) return 'none';
  const plan = floors.pick(x, y);
  return plan ? { open: plan } : 'close';
}

export interface FloorPanelOptions {
  floors: BigMapFloors;
  markers: () => readonly Marker[];
  /** Sim tick now („widziane 3 h temu”). */
  tick: () => number;
  /** Place name for the header (the map's location line). */
  location: () => string;
  onClose: () => void;
}

/** Panel 562 × 604 at the right (mockup floor-bigmap.png). */
export const FLOOR_PANEL = { width: 562, height: 604, right: 18, top: 66 } as const;
/** Plan column limits (px). */
const PLAN_MAX_W = 232;
const PLAN_MAX_H = 430;

const esc = (t: string) =>
  t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f1 = (n: number) => String(Math.round(n * 10) / 10);

/** Outline of a room's tile set (edges with no room tile on the other side). */
function roomOutline(runs: FloorPlan['rooms'][number]['runs']): string {
  const tiles = new Set<string>();
  for (const r of runs) for (let x = r.x0; x < r.x1; x++) tiles.add(`${x},${r.y}`);
  let d = '';
  for (const t of tiles) {
    const [x, y] = t.split(',').map(Number) as [number, number];
    if (!tiles.has(`${x},${y - 1}`)) d += `M${x} ${y}h1`;
    if (!tiles.has(`${x},${y + 1}`)) d += `M${x} ${y + 1}h1`;
    if (!tiles.has(`${x - 1},${y}`)) d += `M${x} ${y}v1`;
    if (!tiles.has(`${x + 1},${y}`)) d += `M${x + 1} ${y}v1`;
  }
  return d;
}

/** SVG of floor z, in plan pixels (north up, `s` px/m, origin at the building box). */
export function planSvg(
  plan: BuildingPlan,
  floor: FloorPlan,
  intel: FloorIntel,
  s: number,
): { svg: string; w: number; h: number } {
  const b: Box = plan.box;
  const w = (b.x1 - b.x0) * s;
  const h = (b.y1 - b.y0) * s;
  // World metres → plan px (the whole group is scaled; strokes do not scale).
  const tr = `translate(${f1(-b.x0 * s)} ${f1(-b.y0 * s)}) scale(${f1(s)})`;
  const ns = 'vector-effect="non-scaling-stroke"';
  const out: string[] = [];
  const labels: string[] = [];
  for (const r of floor.rooms) {
    const st = intel.room(r, floor.z);
    let d = '';
    for (const run of r.runs) d += `M${run.x0} ${run.y}h${run.x1 - run.x0}v1h${run.x0 - run.x1}z`;
    const fill = st === 'searched' ? '#3a4146' : st === 'seen' ? '#2c3337' : 'url(#dzfp-fog)';
    out.push(`<path d="${d}" fill="${fill}"/>`);
    out.push(
      st === 'unknown'
        ? `<path d="${roomOutline(r.runs)}" fill="none" stroke="#5b6469" stroke-width="1" stroke-dasharray="3 3" ${ns}/>`
        : `<path d="${roomOutline(r.runs)}" fill="none" stroke="#9aa3a7" stroke-width="1.2" ${ns}/>`,
    );
    const lab = roomLabel(r.type);
    const bw = (r.box.x1 - r.box.x0) * s;
    const bh = (r.box.y1 - r.box.y0) * s;
    if (st !== 'unknown' && lab && bw > 28 && bh > 16) {
      const lx = (r.label.x - b.x0) * s;
      const ly = (r.label.y - b.y0) * s;
      labels.push(
        `<text x="${f1(lx)}" y="${f1(ly + 4)}" text-anchor="middle" class="dz-fp__rl">${esc(lab)}</text>`,
      );
      if (st === 'searched')
        labels.push(
          `<path d="M${f1(lx - 5)} ${f1(ly + 12)}l3 3l6 -6" stroke="#a9c07a" stroke-width="1.6" fill="none"/>`,
        );
    }
  }
  // Walls: outline light 3 px, windows blue, inner walls under the room outlines; doors = gaps.
  let outer = '';
  let windows = '';
  let doors = '';
  for (const e of floor.edges) {
    const seg = `M${e.x0} ${e.y0}L${e.x1} ${e.y1}`;
    if (e.kind === 'window') windows += seg;
    else if (e.kind === 'door' || e.kind === 'gate') {
      if (e.outer) doors += seg;
    } else if (e.outer) outer += seg;
  }
  out.push(`<path d="${outer}" fill="none" stroke="#e4e6e3" stroke-width="3" ${ns}/>`);
  out.push(`<path d="${windows}" fill="none" stroke="#4fa8c8" stroke-width="3" ${ns}/>`);
  out.push(`<path d="${doors}" fill="none" stroke="#15191c" stroke-width="4" ${ns}/>`);
  // Stairs (accent, treads, arrow up, well letter once per floor).
  const lettered = new Set<string>();
  for (const st of floor.stairs) {
    if (st.way !== 'up') continue;
    const tiles = stairTiles(st);
    const xs = tiles.map((t) => t[0]);
    const ys = tiles.map((t) => t[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs) + 1;
    const y1 = Math.max(...ys) + 1;
    out.push(
      `<path d="M${x0} ${y0}H${x1}V${y1}H${x0}z" fill="rgba(224,162,58,.15)" stroke="#e0a23a" stroke-width="1.2" ${ns}/>`,
    );
    const vertical = st.dir === 'N' || st.dir === 'S';
    const n = Math.max(3, tiles.length * 2);
    let tread = '';
    for (let i = 1; i < n; i++)
      tread += vertical
        ? `M${x0} ${y0 + ((y1 - y0) * i) / n}H${x1}`
        : `M${x0 + ((x1 - x0) * i) / n} ${y0}V${y1}`;
    out.push(`<path d="${tread}" fill="none" stroke="#e0a23a" stroke-width="1" ${ns}/>`);
    // Arrow from the bottom tile towards the top of the flight (screen px, outside the scale).
    const a = tiles[0]!;
    const z = tiles[tiles.length - 1]!;
    const ax = (a[0] + 0.5 - b.x0) * s;
    const ay = (a[1] + 0.5 - b.y0) * s;
    const zx = (z[0] + 0.5 - b.x0) * s;
    const zy = (z[1] + 0.5 - b.y0) * s;
    labels.push(
      `<path d="M${f1(ax)} ${f1(ay)}L${f1(zx)} ${f1(zy)}" stroke="#f0c06a" stroke-width="1.4" marker-end="url(#dzfp-ar)"/>`,
    );
    if (st.well && !lettered.has(st.well)) {
      lettered.add(st.well);
      labels.push(
        `<text x="${f1((x1 - b.x0) * s + 4)}" y="${f1(((y0 + y1) / 2 - b.y0) * s + 4)}" class="dz-fp__well">${st.well}</text>`,
      );
    }
  }
  const defs =
    '<defs><pattern id="dzfp-fog" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#15191c"/><path d="M0 0v6" stroke="#2c3337" stroke-width="2"/></pattern>' +
    '<marker id="dzfp-ar" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4 0 8z" fill="#f0c06a"/></marker></defs>';
  return {
    svg: `<svg class="dz-fp__svg" width="${f1(w + 24)}" height="${f1(h + 8)}" viewBox="-4 -4 ${f1(w + 24)} ${f1(h + 8)}">${defs}<g transform="${tr}">${out.join('')}</g>${labels.join('')}</svg>`,
    w,
    h,
  };
}

export interface FloorPanel {
  /** Panel (in the map root). */
  readonly el: HTMLElement;
  /** Highlight + tag + dashed line (in the map stage, under the pins). */
  readonly overlay: HTMLElement;
  readonly isOpen: boolean;
  /** Opens building `plan`; `z` defaults to the player's floor in it, else the ground floor. */
  open(plan: BuildingPlan, z?: number): void;
  close(): void;
  /** PgUp / PgDn. */
  step(dir: 1 | -1): void;
  frame(view: View, vp: Viewport): void;
}

const LEGEND =
  '<div class="dz-fp__lrow"><i class="dz-fp__sw dz-fp__sw--stairs"></i><span>schody (klatka)</span></div>' +
  '<div class="dz-fp__lrow"><i class="dz-fp__sw dz-fp__sw--searched"></i><span>przeszukane</span></div>' +
  '<div class="dz-fp__lrow"><i class="dz-fp__sw dz-fp__sw--seen"></i><span>widziane</span></div>' +
  '<div class="dz-fp__lrow"><i class="dz-fp__sw dz-fp__sw--fog"></i><span>nieodkryte</span></div>' +
  '<div class="dz-fp__lrow"><i class="dz-fp__sw dz-fp__sw--window"></i><span>okna</span></div>' +
  '<div class="dz-fp__lrow"><i class="dz-fp__sw dz-fp__sw--zombie"></i><span>zombie (ostatnio)</span></div>';

/** Building floors on the big map (deadzone-hud-v2-spec „Duża mapa: piętra budynku”). */
export function createFloorPanel(o: FloorPanelOptions): FloorPanel {
  const el = document.createElement('div');
  el.className = 'dz-fp';
  el.hidden = true;
  const overlay = document.createElement('div');
  overlay.className = 'dz-fp-ov';
  overlay.hidden = true;
  overlay.innerHTML =
    '<svg class="dz-fp-ov__line"><path/></svg><div class="dz-fp-ov__box"></div><div class="dz-fp-ov__tag dz-bm__tag"></div>';
  const ovBox = overlay.querySelector<HTMLElement>('.dz-fp-ov__box')!;
  const ovTag = overlay.querySelector<HTMLElement>('.dz-fp-ov__tag')!;
  const ovLine = overlay.querySelector<SVGPathElement>('.dz-fp-ov__line path')!;
  let plan: BuildingPlan | undefined;
  let z = 0;
  let key = '';
  // Clicks inside the panel do not reach the map (pan / new marker).
  for (const t of ['pointerdown', 'contextmenu', 'wheel'] as const)
    el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-z],[data-close]');
    if (!t) return;
    if (t.dataset.close !== undefined) api.close();
    else if (t.dataset.z !== undefined) {
      z = Number(t.dataset.z);
      key = '';
    }
  });

  const render = () => {
    if (!plan) return;
    const intel = o.floors.intel;
    const markers = o.markers();
    const k = `${plan.id}|${z}|${intel.version}|${markers.length}|${markers.map((m) => `${m.id}:${m.z ?? ''}`).join(',')}`;
    if (k === key) return;
    key = k;
    const floor = plan.floors.get(z);
    const mz = (m: Marker) => intel.markerZ(m.id) ?? m.z ?? 0;
    const here = markers.filter((m) => inBox(plan!.box, m.x, m.y));
    const seen = intel.lastSeenZombies();
    const rows: string[] = [];
    for (let lz = plan.zMax; lz >= plan.zMin; lz--) {
      const f = plan.floors.get(lz);
      const st = f ? floorStats(f, intel) : undefined;
      const zomb = zombiesOnFloor(plan, lz, seen).length > 0;
      const pin = here.some((m) => mz(m) === lz);
      const visited =
        !!st?.visited || (o.floors.current()?.plan.id === plan.id && o.floors.current()?.z === lz);
      // A floor never visited still shows zombies heard there and markers put there.
      const icons =
        visited || zomb || pin
          ? (zomb ? '<i class="dz-fp__zd"></i>' : '') +
            (pin ? bmIcon('pin', '#4F86C6', 11, 2.4) : '')
          : '<span class="dz-fp__none">—</span>';
      rows.push(
        `<button class="dz-fp__row${lz === z ? ' sel' : ''}${visited ? ' visited' : ''}" data-z="${lz}"><b>${floorShort(lz)}</b><span class="dz-fp__ri">${icons}</span></button>`,
      );
    }
    const s = planScale(
      plan.box.x1 - plan.box.x0,
      plan.box.y1 - plan.box.y0,
      PLAN_MAX_W,
      PLAN_MAX_H,
    );
    const p = floor ? planSvg(plan, floor, intel, s) : undefined;
    const toPx = (x: number, y: number) => ({
      x: (x - plan!.box.x0) * s,
      y: (y - plan!.box.y0) * s,
    });
    const onFloor = here.filter((m) => mz(m) === z);
    const zs = zombiesOnFloor(plan, z, seen);
    const pins = onFloor
      .map((m) => {
        const q = toPx(m.x, m.y);
        return `<div class="dz-fp__pin" style="left:${f1(q.x - 7)}px;top:${f1(q.y - 7)}px;--c:${markerHex(m.color)}">${bmIcon(markerGlyph(m.icon), markerHex(m.color), 12, 2.2)}</div>`;
      })
      .join('');
    const zdots = zs
      .map((zz) => {
        const q = toPx(zz.x, zz.y);
        return `<i class="dz-fp__zp" style="left:${f1(q.x)}px;top:${f1(q.y)}px"></i>`;
      })
      .join('');
    const st = floor ? floorStats(floor, intel) : undefined;
    const name = floorName(z, plan.zMin);
    const newest = zs.reduce((t, zz) => Math.max(t, zz.tick), -Infinity);
    const info =
      `<div class="dz-bm__h6">${name}</div>` +
      `<div class="dz-fp__stats">pomieszczenia: <b>${st?.rooms ?? 0}</b><br>przeszukane: <b class="ok">${st?.searched ?? 0}</b> · widziane: <b>${st?.seen ?? 0}</b><br>nieodkryte: <b class="dim">${st?.unknown ?? 0}</b></div>` +
      '<div class="dz-bm__sep"></div>' +
      (onFloor.length
        ? onFloor
            .map(
              (m) =>
                `<div class="dz-fp__item">${bmIcon(markerGlyph(m.icon), markerHex(m.color), 13, 2.2)}<span>${esc(m.text || 'Znacznik')}</span></div><div class="dz-fp__sub">Twój znacznik</div>`,
            )
            .join('')
        : '<div class="dz-fp__sub">Brak znaczników na tym piętrze</div>') +
      (zs.length
        ? `<div class="dz-fp__item"><i class="dz-fp__zd"></i><span>${zs.length} zombie</span></div><div class="dz-fp__sub">${agoText(o.tick(), newest)}</div>`
        : '') +
      '<div class="dz-bm__sep"></div>' +
      `<div class="dz-bm__h6">LEGENDA</div>${LEGEND}`;
    const w = Math.round(plan.box.x1 - plan.box.x0);
    const h = Math.round(plan.box.y1 - plan.box.y0);
    const chips =
      `<span class="dz-bm__chip on">${storeysChip(plan.zMin, plan.zMax)}</span>` +
      (plan.zMin < 0 ? '<span class="dz-bm__chip">PIWNICA</span>' : '') +
      (plan.stairwells > 0
        ? `<span class="dz-bm__chip">${stairwellsChip(plan.stairwells)}</span>`
        : '');
    el.innerHTML =
      `<div class="dz-fp__head"><div class="dz-fp__ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F0C06A" stroke-width="1.8"><path d="M6 21V3h12v18M3 21h18M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/></svg></div>` +
      `<div class="dz-fp__title"><div class="dz-fp__kind">${plan.kind}</div><div class="dz-fp__addr">${w} × ${h} m · ${esc(o.location())}</div></div>` +
      `<span class="dz-bm__key">ESC</span><button class="dz-fp__x" data-close aria-label="Zamknij">${bmIcon('x', 'var(--bm-n300)', 16)}</button></div>` +
      `<div class="dz-fp__chips">${chips}</div><div class="dz-bm__sep dz-bm__sep--wide"></div>` +
      `<div class="dz-fp__body"><div class="dz-fp__floors"><div class="dz-bm__h6">PIĘTRO</div><div class="dz-fp__list">${rows.join('')}</div>` +
      '<div class="dz-fp__keys"><span class="dz-bm__key">PG UP</span><span class="dz-bm__key">PG DN</span></div></div>' +
      `<div class="dz-fp__plan"><div class="dz-bm__h6">RZUT · ${name}</div><div class="dz-fp__canvas">${p?.svg ?? ''}${pins}${zdots}</div>` +
      `<div class="dz-fp__cap">północ u góry, jak na mapie · ${w} × ${h} m</div></div>` +
      `<div class="dz-fp__info">${info}</div></div>`;
  };

  const api: FloorPanel = {
    el,
    overlay,
    get isOpen() {
      return !el.hidden;
    },
    open(next, at) {
      plan = next;
      const cur = o.floors.current();
      const def = cur?.plan.id === next.id ? cur.z : 0;
      z = Math.min(next.zMax, Math.max(next.zMin, at ?? def));
      key = '';
      el.hidden = false;
      overlay.hidden = false;
      ovTag.textContent = buildingTag(next.tag, next.zMax);
      render();
    },
    close() {
      if (el.hidden) return;
      el.hidden = true;
      overlay.hidden = true;
      plan = undefined;
      o.onClose();
    },
    step(dir) {
      if (!plan) return;
      const n = Math.min(plan.zMax, Math.max(plan.zMin, z + dir));
      if (n !== z) {
        z = n;
        key = '';
      }
    },
    frame(view, vp) {
      if (!plan || el.hidden) return;
      render();
      const a = worldToScreen(view, vp, plan.box.x0, plan.box.y0);
      const b = worldToScreen(view, vp, plan.box.x1, plan.box.y1);
      ovBox.style.transform = `translate(${f1(a.x - 4)}px, ${f1(a.y - 4)}px)`;
      ovBox.style.width = `${f1(b.x - a.x + 8)}px`;
      ovBox.style.height = `${f1(b.y - a.y + 8)}px`;
      ovTag.style.transform = `translate(${f1(a.x - 4)}px, ${f1(a.y - 34)}px)`;
      const panelX = vp.width - FLOOR_PANEL.right - FLOOR_PANEL.width;
      const my = (a.y + b.y) / 2;
      ovLine.setAttribute('d', b.x + 6 < panelX ? `M${f1(b.x + 6)} ${f1(my)}H${panelX}` : '');
    },
  };
  return api;
}
