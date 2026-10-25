import './floor-hud.css';
import { stairTiles, type FloorPlan } from '../floors/building-plan.js';
import { floorName } from '../floors/floor-names.js';

/**
 * Floors in the HUD (deadzone-hud-v2-spec „Piętra (UI)”, mockups floor-hud.png /
 * floor-stairs.png): the floor badge at the minimap's left edge, the „1 PIĘTRO” toast on a
 * level change and the current floor's plan with zombies of the floors ±1 on the minimap.
 */
export interface FloorHudVM {
  /** Player inside a building; outside the badge and the plan are gone. */
  inside: boolean;
  /** Player level. */
  z: number;
  /** Building levels (badge arrows: a level above / below exists). */
  zMin: number;
  zMax: number;
  /** Building id + plan of the current floor (minimap). */
  building?: number;
  plan?: FloorPlan | undefined;
  /** Zombies the player senses, with their level (only ±1 floors are drawn). */
  zombies: readonly { x: number; y: number; z: number }[];
}

/** Badge change: accent + slide for this long (spec: 220 ms slide, arrow lit 600 ms). */
export const FLOOR_CHANGE_MS = 600;
/** Toast: in 150 ms, holds 1.2 s, out 300 ms. */
export const FLOOR_TOAST_IN_MS = 150;
export const FLOOR_TOAST_HOLD_MS = 1200;
export const FLOOR_TOAST_OUT_MS = 300;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Up / down chevron in SVG (the Deadzone font has no ↑↓ glyphs). */
export function chevronSvg(up: boolean, size = 10): string {
  const d = up ? 'M2 8l5-5 5 5' : 'M2 3l5 5 5-5';
  return `<svg class="dz-floor__chev" width="${size + 4}" height="${size - 1}" viewBox="0 0 14 11" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** Minimap layer key (rebuild only when the building / floor / plan changes). */
const planKey = (vm: FloorHudVM) =>
  vm.inside && vm.plan ? `${vm.building ?? 0}:${vm.plan.z}:${vm.plan.rooms.length}` : '';

/** SVG path (`M x y h w v 1 h -w z` per row run) of the floor's room tiles. */
export function roomsPath(plan: FloorPlan): string {
  let d = '';
  for (const r of plan.rooms)
    for (const run of r.runs) d += `M${run.x0} ${run.y}h${run.x1 - run.x0}v1h${run.x0 - run.x1}z`;
  return d;
}

/** Wall / window segments as one path each (doors stay open gaps). */
export function edgePaths(plan: FloorPlan): { outer: string; inner: string; windows: string } {
  let outer = '';
  let inner = '';
  let windows = '';
  for (const e of plan.edges) {
    const seg = `M${e.x0} ${e.y0}L${e.x1} ${e.y1}`;
    if (e.kind === 'window') windows += seg;
    else if (e.kind === 'door' || e.kind === 'gate') continue;
    else if (e.outer) outer += seg;
    else inner += seg;
  }
  return { outer, inner, windows };
}

/** Flights of stairs: tile boxes plus one tread line per tile (accent). */
export function stairsPath(plan: FloorPlan): { box: string; treads: string } {
  let box = '';
  let treads = '';
  for (const s of plan.stairs) {
    if (s.way !== 'up') continue;
    const tiles = stairTiles(s);
    const xs = tiles.map((t) => t[0]);
    const ys = tiles.map((t) => t[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs) + 1;
    const y1 = Math.max(...ys) + 1;
    box += `M${x0} ${y0}H${x1}V${y1}H${x0}z`;
    const vertical = s.dir === 'N' || s.dir === 'S';
    const n = Math.max(2, tiles.length * 2);
    for (let i = 1; i < n; i++) {
      if (vertical) treads += `M${x0} ${y0 + ((y1 - y0) * i) / n}H${x1}`;
      else treads += `M${x0 + ((x1 - x0) * i) / n} ${y0}V${y1}`;
    }
  }
  return { box, treads };
}

export interface FloorHud {
  /** Badge (child of the minimap group: moves and scales with `minimap` in the HUD editor). */
  readonly badge: HTMLElement;
  /** Toast (own group, top centre). */
  readonly toast: HTMLElement;
  update(vm: FloorHudVM, now: number, pxPerM: number): void;
  /** HUD editor sample: the badge shows („1 PIĘTRO”) so it can be seen with the minimap. */
  setEditPreview(on: boolean): void;
}

/**
 * `minimapWorld`: the minimap's world layer (`.dz-minimap__world`, metres, already moved /
 * scaled around the player); the plan and the other-floor zombies are drawn into it.
 */
export function createFloorHud(minimapWorld: Element | null): FloorHud {
  const badge = document.createElement('div');
  badge.className = 'dz-floor dz-glass';
  badge.hidden = true;
  badge.innerHTML =
    `<span class="dz-floor__up">${chevronSvg(true)}</span>` +
    '<span class="dz-floor__names"><b class="dz-floor__prev"></b><b class="dz-floor__name"></b></span>' +
    `<span class="dz-floor__down">${chevronSvg(false)}</span>`;
  const name = badge.querySelector<HTMLElement>('.dz-floor__name')!;
  const prev = badge.querySelector<HTMLElement>('.dz-floor__prev')!;
  const up = badge.querySelector<HTMLElement>('.dz-floor__up')!;
  const down = badge.querySelector<HTMLElement>('.dz-floor__down')!;

  const toast = document.createElement('div');
  toast.className = 'dz-floortoast';
  toast.hidden = true;
  toast.innerHTML = `<span class="dz-floortoast__chev"></span><b class="dz-floortoast__text"></b>`;
  const toastChev = toast.querySelector<HTMLElement>('.dz-floortoast__chev')!;
  const toastText = toast.querySelector<HTMLElement>('.dz-floortoast__text')!;

  const layer = svg('g', { class: 'dz-mmfloor' });
  const zombieLayer = svg('g', { class: 'dz-mmfloor__zombies' });
  minimapWorld?.append(layer, zombieLayer);

  let lastZ: number | undefined;
  let lastInside = false;
  let changeUntil = 0;
  let drawnKey = '';
  let zombieKey = '';
  let preview = false;
  let last: FloorHudVM | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const setBadge = (vm: FloorHudVM) => {
    if (name.textContent !== floorName(vm.z, vm.zMin)) name.textContent = floorName(vm.z, vm.zMin);
    up.classList.toggle('off', vm.z >= vm.zMax);
    down.classList.toggle('off', vm.z <= vm.zMin);
  };

  const drawPlan = (vm: FloorHudVM) => {
    const key = planKey(vm);
    if (key === drawnKey) return;
    drawnKey = key;
    // Crossfade (220 ms): the old floor fades out, the new one fades in.
    for (const old of [...layer.children]) {
      old.classList.add('out');
      setTimeout(() => old.remove(), 260);
    }
    if (!key || !vm.plan) return;
    const g = svg('g', { class: 'dz-mmfloor__plan in' });
    const e = edgePaths(vm.plan);
    const st = stairsPath(vm.plan);
    const ns = { 'vector-effect': 'non-scaling-stroke' };
    g.append(
      svg('path', { class: 'dz-mmfloor__rooms', d: roomsPath(vm.plan) }),
      svg('path', { class: 'dz-mmfloor__stairs', d: st.box, ...ns }),
      svg('path', { class: 'dz-mmfloor__treads', d: st.treads, ...ns }),
      svg('path', { class: 'dz-mmfloor__inner', d: e.inner, ...ns }),
      svg('path', { class: 'dz-mmfloor__outer', d: e.outer, ...ns }),
      svg('path', { class: 'dz-mmfloor__windows', d: e.windows, ...ns }),
    );
    layer.append(g);
    requestAnimationFrame(() => g.classList.remove('in'));
  };

  const drawZombies = (vm: FloorHudVM, pxPerM: number) => {
    const list = vm.inside ? vm.zombies.filter((z) => Math.abs(z.z - vm.z) <= 1) : vm.zombies;
    const key = `${pxPerM.toFixed(3)}|${vm.z}|${list.map((z) => `${z.x.toFixed(1)},${z.y.toFixed(1)},${z.z}`).join(';')}`;
    if (key === zombieKey) return;
    zombieKey = key;
    const k = 1 / Math.max(0.01, pxPerM);
    const els: SVGElement[] = [];
    for (const z of list) {
      const dz = Math.sign(Math.floor(z.z) - vm.z);
      if (dz === 0) {
        els.push(svg('circle', { class: 'dz-mmfloor__z', cx: z.x, cy: z.y, r: 3.6 * k }));
        continue;
      }
      const g = svg('g', { class: 'dz-mmfloor__z dz-mmfloor__z--other' });
      g.append(svg('circle', { cx: z.x, cy: z.y, r: 3.2 * k }));
      // ▲ above / ▼ below, right of the dot.
      const x = z.x + 5 * k;
      const d =
        dz > 0
          ? `M${x} ${z.y - 1 * k}l${3 * k} ${-4 * k}l${3 * k} ${4 * k}z`
          : `M${x} ${z.y - 4 * k}l${3 * k} ${4 * k}l${3 * k} ${-4 * k}z`;
      g.append(svg('path', { class: 'dz-mmfloor__tri', d }));
      els.push(g);
    }
    zombieLayer.replaceChildren(...els);
  };

  const showToast = (vm: FloorHudVM, dir: number) => {
    toastChev.innerHTML = chevronSvg(dir > 0, 12);
    toastText.textContent = floorName(vm.z, vm.zMin);
    const visible = !toast.hidden && toast.dataset.phase !== 'out';
    toast.hidden = false;
    // A change during the toast only swaps the text (no new entrance).
    if (!visible) {
      toast.dataset.phase = 'in';
      void toast.offsetWidth;
      toast.dataset.phase = 'hold';
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      toast.dataset.phase = 'out';
      timer = setTimeout(() => {
        toast.hidden = true;
        timer = undefined;
      }, FLOOR_TOAST_OUT_MS);
    }, FLOOR_TOAST_IN_MS + FLOOR_TOAST_HOLD_MS);
  };

  return {
    badge,
    toast,
    update(vm, now, pxPerM) {
      last = vm;
      const show = vm.inside || preview;
      badge.hidden = !show;
      if (vm.inside) {
        if (lastInside && lastZ !== undefined && vm.z !== lastZ) {
          const dir = Math.sign(vm.z - lastZ);
          prev.textContent = floorName(lastZ, vm.zMin);
          badge.dataset.change = dir > 0 ? 'up' : 'down';
          // Restart the slide animation.
          badge.classList.remove('dz-floor--change');
          void badge.offsetWidth;
          badge.classList.add('dz-floor--change');
          changeUntil = now + FLOOR_CHANGE_MS;
          showToast(vm, dir);
        }
        setBadge(vm);
      } else if (preview) setBadge({ ...vm, z: 1, zMin: 0, zMax: 4 });
      if (changeUntil && now >= changeUntil) {
        changeUntil = 0;
        badge.classList.remove('dz-floor--change');
        delete badge.dataset.change;
      }
      lastInside = vm.inside;
      lastZ = vm.inside ? vm.z : undefined;
      drawPlan(vm);
      drawZombies(vm, pxPerM);
    },
    setEditPreview(on) {
      preview = on;
      if (last) {
        badge.hidden = !(last.inside || on);
        if (on && !last.inside) setBadge({ ...last, z: 1, zMin: 0, zMax: 4 });
      } else badge.hidden = !on;
      if (on && !last?.inside) setBadge({ inside: false, z: 1, zMin: 0, zMax: 4, zombies: [] });
    },
  };
}
