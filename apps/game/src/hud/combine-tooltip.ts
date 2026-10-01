import './combine-tooltip.css';
import { createIcon, createStatRows } from '@deadzone/ui';
import type { CombineTipVM } from './combine-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Chain-link glyph of the combine badge / header / button (mockup `link`). */
export function linkIcon(size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of [
    'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7',
    'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  ]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

const div = (cls: string, text?: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
};

const keyChip = (k: string): HTMLElement => {
  const s = document.createElement('span');
  s.className = 'dz-ct__key';
  s.textContent = k;
  return s;
};

export interface CombineTooltip {
  readonly el: HTMLElement;
  show(vm: CombineTipVM, keys: { combine: string; context?: string }): void;
  hide(): void;
  place(pos: { left: number; top: number }): void;
}

/** Combine tooltip (mockup combine.png, right): result, ≤ 4 parts, skill / time, `Połącz [C]`. */
export function createCombineTooltip(): CombineTooltip {
  const el = div('dz-ct');
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  return {
    el,
    show(vm, keys) {
      const head = div('dz-ct__head');
      const title = div(
        'dz-ct__label dz-ct__label--acc',
        `Łączenie · ${vm.partCount} ${vm.partCount === 1 ? 'część' : 'części'} (maks. 4)`,
      );
      head.append(linkIcon(14), title);
      if (keys.context) head.append(keyChip(keys.context));
      const result = div('dz-ct__result');
      const ib = div('dz-ct__ib');
      if (vm.result.image) {
        const img = document.createElement('img');
        img.src = vm.result.image;
        img.alt = '';
        ib.append(img);
      } else if (vm.result.icon) {
        const svg = createIcon(document, vm.result.icon, 32);
        if (svg) ib.append(svg);
      }
      const rtext = div('dz-ct__rtext');
      rtext.append(
        div('dz-ct__label dz-ct__label--sm', 'Wynik'),
        div(
          'dz-ct__rname',
          vm.result.count > 1 ? `${vm.result.name} ×${vm.result.count}` : vm.result.name,
        ),
        div('dz-ct__rcat', vm.result.category),
      );
      result.append(ib, rtext);
      const stats = createStatRows(vm.stats);
      const partsHead = div('dz-ct__row');
      const count = div('dz-ct__count', `${vm.partsOk}/${vm.partCount}`);
      if (vm.partsOk < vm.partCount) count.dataset.miss = 'true';
      partsHead.append(div('dz-ct__label dz-ct__grow', 'Wymagane części'), count);
      const parts = div('dz-ct__parts');
      for (const p of vm.parts) {
        const row = div('dz-ct__part');
        if (!p.ok) row.dataset.miss = 'true';
        const txt = div('dz-ct__grow');
        txt.append(
          div('dz-ct__pname', p.name),
          div('dz-ct__psrc', p.ok ? 'Pod ręką' : 'Brak w pobliżu'),
        );
        row.append(
          txt,
          div('dz-ct__pcount', `${p.have}/${p.need}`),
          div('dz-ct__mark', p.ok ? '✓' : '✕'),
        );
        parts.append(row);
      }
      const meta = div('dz-ct__meta');
      if (vm.skill) {
        const s = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = String(vm.skill.need);
        if (!vm.skill.ok) b.dataset.miss = 'true';
        s.append(`${vm.skill.name} `, b, ` (masz ${vm.skill.have})`);
        meta.append(s);
      }
      const t = document.createElement('span');
      const tb = document.createElement('b');
      tb.textContent = vm.time;
      t.append('Czas ', tb);
      meta.append(t);
      for (const tool of vm.tools) {
        const s = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = tool.ok ? '✓' : '✕';
        if (!tool.ok) b.dataset.miss = 'true';
        s.append(`${tool.name} `, b);
        meta.append(s);
      }
      const btn = div('dz-ct__btn');
      if (!vm.ready) btn.dataset.disabled = 'true';
      btn.append(linkIcon(16), 'Połącz', keyChip(keys.combine));
      const sep = div('dz-ct__sep');
      el.replaceChildren(head, result, stats.el, sep, partsHead, parts, meta, btn);
      if (vm.missing) el.append(div('dz-ct__missing', `▲ Brakuje: ${vm.missing}`));
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
    place({ left, top }) {
      el.style.transform = `translate(${left}px, ${top}px)`;
    },
  };
}
