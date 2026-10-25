import type { BigMapLayers } from './bigmap-model.js';
import { LEGEND, bmIcon, markerGlyph } from './icons.js';
import { markerHex } from './bigmap-model.js';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export interface TopBarHandlers {
  zoom(dir: 1 | -1): void;
  center(): void;
  layer(name: keyof BigMapLayers): void;
  close(): void;
}

export interface BigMapTopBar {
  readonly el: HTMLElement;
  update(v: {
    subtitle: string;
    zoom: string;
    layers: BigMapLayers;
    markers: number;
    scale: { px: number; labels: string[] };
  }): void;
}

/** Top bar 1280×52 (spec §11): title, zoom − 1,0× +, centre, layers, scale bar, M / Esc ×. */
export function createTopBar(h: TopBarHandlers): BigMapTopBar {
  const bar = el('div', 'dz-bm__bar');
  const title = el(
    'div',
    'dz-bm__title',
    `${bmIcon('map', 'var(--bm-acc)', 20)}<div><div class="dz-bm__h1">MAPA</div><div class="dz-bm__sub"></div></div>`,
  );
  const sub = title.querySelector<HTMLElement>('.dz-bm__sub')!;
  const zoom = el('div', 'dz-bm__grp');
  const minus = el('button', 'dz-bm__ib', bmIcon('minus', 'var(--bm-n100)', 16));
  const zoomVal = el('div', 'dz-bm__zoom');
  const plus = el('button', 'dz-bm__ib', bmIcon('plus', 'var(--bm-n100)', 16));
  minus.title = 'oddal';
  plus.title = 'przybliż';
  minus.addEventListener('click', () => h.zoom(-1));
  plus.addEventListener('click', () => h.zoom(1));
  zoom.append(minus, zoomVal, plus);
  const center = el('button', 'dz-bm__ib dz-bm__ib--box', bmIcon('target', 'var(--bm-n300)', 17));
  center.title = 'wyśrodkuj na graczu';
  center.addEventListener('click', () => h.center());
  const chips: Record<keyof BigMapLayers, HTMLButtonElement> = {
    markers: el('button', 'dz-bm__chip'),
    trail: el('button', 'dz-bm__chip'),
    grid: el('button', 'dz-bm__chip'),
  };
  const chipIcon = { markers: 'pin', trail: 'trail', grid: 'grid' } as const;
  const chipLabel = { markers: 'ZNACZNIKI', trail: 'ŚLAD', grid: 'SIATKA' };
  for (const k of Object.keys(chips) as (keyof BigMapLayers)[]) {
    chips[k].addEventListener('click', () => h.layer(k));
  }
  const scale = el('div', 'dz-bm__scale');
  const scaleLabels = el('div', 'dz-bm__scale-lbl');
  const scaleBar = el(
    'div',
    'dz-bm__scale-bar',
    '<span class="on"></span><span></span><span class="on"></span><span></span>',
  );
  scale.append(scaleLabels, scaleBar);
  const close = el(
    'button',
    'dz-bm__close',
    `<span class="dz-bm__key">M</span><span class="dz-bm__key">ESC</span>${bmIcon('x', 'var(--bm-n300)', 16)}`,
  );
  close.addEventListener('click', () => h.close());
  bar.append(
    title,
    el('div', 'dz-bm__vsep'),
    zoom,
    center,
    el('div', 'dz-bm__vsep'),
    el('div', 'dz-bm__h6', 'WARSTWY'),
    chips.markers,
    chips.trail,
    chips.grid,
    el('div', 'dz-bm__flex'),
    scale,
    el('div', 'dz-bm__vsep'),
    close,
  );
  let last = '';
  return {
    el: bar,
    update(v) {
      const key = JSON.stringify(v);
      if (key === last) return;
      last = key;
      sub.textContent = v.subtitle;
      zoomVal.textContent = v.zoom;
      for (const k of Object.keys(chips) as (keyof BigMapLayers)[]) {
        const on = v.layers[k];
        chips[k].classList.toggle('on', on);
        chips[k].innerHTML =
          `<span class="dz-bm__bx">${on ? bmIcon('check', '#0E1113', 11, 3) : ''}</span>` +
          bmIcon(chipIcon[k], on ? 'var(--bm-n100)' : 'var(--bm-n300)', 14) +
          chipLabel[k] +
          (k === 'markers' ? ` <span class="dz-bm__cnt">${v.markers}</span>` : '');
      }
      scale.style.width = `${v.scale.px}px`;
      scaleLabels.innerHTML = v.scale.labels.map((l) => `<span>${l}</span>`).join('');
    },
  };
}

export interface BigMapFooter {
  readonly el: HTMLElement;
  update(cursor: string, discovered: { count: string; rest: string }): void;
}

/** Footer 1280×38: controls on the left, cursor cell / metres and discovery on the right. */
export function createFooter(opts: { floors?: boolean } = {}): BigMapFooter {
  const foot = el('div', 'dz-bm__foot');
  const k = (icon: string, keys: string[], label: string) =>
    `<div class="dz-bm__k">${icon}${keys.map((x) => `<span class="dz-bm__key">${x}</span>`).join('')}<span>${label}</span></div>`;
  foot.innerHTML =
    k(bmIcon('mouseL', 'var(--bm-n100)', 16), ['LPM'], 'przesuń') +
    k(bmIcon('wheel', 'var(--bm-n100)', 16), ['KÓŁKO'], 'zoom') +
    k(bmIcon('mouseR', 'var(--bm-n100)', 16), ['PPM'], 'dodaj znacznik') +
    k('', ['LPM'], 'na znaczniku: edytuj') +
    (opts.floors ? k('', ['LPM'], 'na budynku: piętra') : '') +
    k('', ['SPACJA'], 'do gracza') +
    k('', ['M', 'ESC'], 'zamknij') +
    '<div class="dz-bm__flex"></div><span>kursor <b class="dz-bm__cur"></b></span><span class="dz-bm__dot">·</span><span>odkryto <b class="dz-bm__disc"></b><span class="dz-bm__disc-rest"></span></span>';
  const cur = foot.querySelector<HTMLElement>('.dz-bm__cur')!;
  const disc = foot.querySelector<HTMLElement>('.dz-bm__disc')!;
  const rest = foot.querySelector<HTMLElement>('.dz-bm__disc-rest')!;
  return {
    el: foot,
    update(c, d) {
      if (cur.textContent !== c) cur.textContent = c;
      if (disc.textContent !== d.count) disc.textContent = d.count;
      if (rest.textContent !== d.rest) rest.textContent = d.rest;
    },
  };
}

/** Legend (right 18, bottom 56, 196 px), collapsible. */
export function createLegend(): HTMLElement {
  const box = el('div', 'dz-bm__legend');
  const head = el('button', 'dz-bm__h6 dz-bm__legend-head', 'LEGENDA');
  const body = el('div', 'dz-bm__legend-body');
  body.innerHTML =
    LEGEND.map(
      (r) =>
        `<div class="dz-bm__lrow">${bmIcon(markerGlyph(r.icon), markerHex(r.color), 15, 2)}<span>${r.label}</span></div>`,
    ).join('') +
    '<div class="dz-bm__sep"></div>' +
    '<div class="dz-bm__lrow"><svg width="26" height="8"><path d="M1 4h7M12 4h7M23 4h3" stroke="#A01E16" stroke-width="3"/></svg><span>twój ślad (48 h)</span></div>' +
    '<div class="dz-bm__lrow"><svg width="26" height="14"><path d="M13 1L22 13 13 9 4 13z" fill="#E0A23A"/></svg><span>gracz</span></div>' +
    '<div class="dz-bm__lrow"><div class="dz-bm__fogsw"></div><span>nieodkryte / odkryte</span></div>';
  head.addEventListener('click', () => box.classList.toggle('collapsed'));
  box.append(head, body);
  return box;
}

/** North indicator (30, 70 · 38×52). */
export const createNorth = (): HTMLElement =>
  el(
    'div',
    'dz-bm__north',
    '<svg width="16" height="22" viewBox="0 0 16 22"><path d="M8 1l6 18-6-4-6 4z" fill="#E0A23A"/></svg><div>N</div>',
  );
