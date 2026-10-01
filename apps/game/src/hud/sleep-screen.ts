import './sleep-screen.css';
import type { SleepScreenVM } from './sleep-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Ring radius in the 200×200 view box. */
const RING_R = 88;
const RING_LEN = 2 * Math.PI * RING_R;

const div = (cls: string, text?: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
};

const keyChip = (k: string): HTMLElement => {
  const s = document.createElement('span');
  s.className = 'dz-sleep__key';
  s.textContent = k;
  return s;
};

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** Crescent moon (mockup header). */
function moon(): SVGElement {
  const s = svg('svg', { viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true' });
  s.append(
    svg('path', { d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z', fill: 'currentColor' }),
  );
  return s;
}

export interface SleepScreenOptions {
  root: HTMLElement;
  onWake: () => void;
  onSpeed: (x: 1 | 2 | 4) => void;
  /** Key labels: wake (Esc) and the speed keys (1, 2, 4). */
  keys: () => { wake: string; speed: [string, string, string] };
}

export interface SleepScreen {
  readonly open: boolean;
  /** Shows / updates the panel (null hides it). Cheap when the model did not change. */
  update(vm: SleepScreenVM | null): void;
}

/** Sleep screen (approved mockup sleep.png): centred panel over a dimmed world, HUD hidden. */
export function createSleepScreen(opts: SleepScreenOptions): SleepScreen {
  const el = div('dz-sleep');
  el.hidden = true;
  const panel = div('dz-sleep__panel');
  el.append(panel);
  opts.root.append(el);

  // Header.
  const head = div('dz-sleep__head');
  const titleBox = div('dz-sleep__titles');
  const title = div('dz-sleep__title');
  const subtitle = div('dz-sleep__subtitle');
  const titleRow = div('dz-sleep__title-row');
  const moonEl = div('dz-sleep__moon');
  moonEl.append(moon());
  titleRow.append(moonEl, title);
  titleBox.append(titleRow, subtitle);
  const safe = div('dz-sleep__safe');
  head.append(titleBox, safe);

  // Ring (real time) + game time.
  const mid = div('dz-sleep__mid');
  const ring = div('dz-sleep__ring');
  const ringSvg = svg('svg', { viewBox: '0 0 200 200', class: 'dz-sleep__ring-svg' });
  ringSvg.append(
    svg('circle', { cx: '100', cy: '100', r: String(RING_R), class: 'dz-sleep__ring-track' }),
  );
  const arc = svg('circle', {
    cx: '100',
    cy: '100',
    r: String(RING_R),
    class: 'dz-sleep__ring-arc',
    'stroke-dasharray': RING_LEN.toFixed(1),
  });
  const knob = svg('circle', { r: '7', class: 'dz-sleep__ring-knob' });
  ringSvg.append(arc, knob);
  const ringText = div('dz-sleep__ring-text');
  const realVal = div('dz-sleep__real');
  const realTotal = div('dz-sleep__real-total');
  ringText.append(div('dz-sleep__label', 'Czas rzeczywisty'), realVal, realTotal);
  ring.append(ringSvg, ringText);

  const game = div('dz-sleep__game');
  const gameTime = div('dz-sleep__game-time');
  const ratio = div('dz-sleep__chip');
  const timeRow = div('dz-sleep__time-row');
  timeRow.append(gameTime, ratio);
  const from = div('dz-sleep__from');
  const bar = div('dz-sleep__bar');
  const barFill = div('dz-sleep__bar-fill');
  bar.append(barFill);
  const to = div('dz-sleep__to');
  const progress = div('dz-sleep__progress');
  progress.append(from, bar, to);
  const save = div('dz-sleep__save');
  const saveIcon = div('dz-sleep__save-icon', '▣');
  const saveText = div('dz-sleep__save-text');
  const saveTitle = div('dz-sleep__save-title');
  const saveDetail = div('dz-sleep__save-detail');
  saveText.append(saveTitle, saveDetail);
  save.append(saveIcon, saveText);
  const speed = div('dz-sleep__speed');
  const speedBtns = ([1, 2, 4] as const).map((x) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dz-sleep__speed-btn';
    b.addEventListener('click', () => opts.onSpeed(x));
    speed.append(b);
    return { x, b };
  });
  game.append(div('dz-sleep__label', 'Czas gry · przewijanie'), timeRow, progress, save, speed);
  mid.append(ring, game);

  // Rest preview.
  const restHead = div('dz-sleep__rest-head');
  restHead.append(
    div('dz-sleep__label', 'Odpoczynek · podgląd'),
    div('dz-sleep__muted', 'na żywo'),
  );
  const rows = div('dz-sleep__rows');

  // Wake button.
  const foot = div('dz-sleep__foot');
  const wake = document.createElement('button');
  wake.type = 'button';
  wake.className = 'dz-sleep__wake';
  wake.addEventListener('click', () => opts.onWake());
  const wakeNote = div('dz-sleep__wake-note');
  foot.append(wake, wakeNote);

  panel.append(head, mid, div('dz-sleep__sep'), restHead, rows, foot);

  let key = '';
  let shown = false;
  const render = (vm: SleepScreenVM): void => {
    const keys = opts.keys();
    title.textContent = vm.title;
    subtitle.textContent = vm.subtitle;
    const [lead = '', ...rest] = vm.safeText.split(' · ');
    const strong = document.createElement('b');
    strong.textContent = `${vm.safe ? '✓' : '▲'} ${lead.toUpperCase()}`;
    safe.replaceChildren(strong, rest.length ? ` · ${rest.join(' · ')}` : '');
    safe.dataset.tone = vm.safe ? 'ok' : 'danger';
    realVal.textContent = vm.real.text;
    realTotal.textContent = vm.real.total;
    arc.setAttribute('stroke-dashoffset', (RING_LEN * (1 - vm.real.pct)).toFixed(1));
    // Knob at the arc end (the arc starts at 12 o'clock, clockwise).
    const a = -Math.PI / 2 + vm.real.pct * 2 * Math.PI;
    knob.setAttribute('cx', (100 + RING_R * Math.cos(a)).toFixed(1));
    knob.setAttribute('cy', (100 + RING_R * Math.sin(a)).toFixed(1));
    ring.dataset.ready = String(vm.save.ready);
    gameTime.textContent = vm.game.time;
    ratio.textContent = `≫ ${vm.game.ratio}`;
    from.textContent = vm.game.from;
    barFill.style.width = `${(vm.game.pct * 100).toFixed(1)}%`;
    to.textContent = vm.game.to;
    save.dataset.ready = String(vm.save.ready);
    saveIcon.textContent = vm.save.ready ? '✓' : '▣';
    saveTitle.textContent = vm.save.title;
    saveDetail.textContent = vm.save.detail;
    speed.dataset.blocked = String(vm.speedBlocked);
    speedBtns.forEach(({ x, b }, i) => {
      b.replaceChildren(keyChip(keys.speed[i]!), `×${x}`);
      b.dataset.active = String(vm.speed === x);
      b.disabled = vm.speedBlocked && x !== 1;
    });
    rows.replaceChildren(
      ...vm.rows.map((r) => {
        const row = div('dz-sleep__row');
        const val = div('dz-sleep__val');
        val.dataset.tone = r.tone;
        if (r.bar !== undefined) {
          const b = div('dz-sleep__mini');
          const f = document.createElement('i');
          f.style.width = `${Math.round(r.bar * 100)}%`;
          b.append(f);
          val.append(b);
        }
        val.append(r.value);
        if (r.note) {
          const n = document.createElement('small');
          n.textContent = r.note;
          val.append(n);
        }
        row.append(div('dz-sleep__row-label', r.label), val);
        return row;
      }),
    );
    wake.replaceChildren('✕ Obudź się', keyChip(keys.wake));
    wakeNote.textContent = vm.wakeNote.text;
    wakeNote.dataset.tone = vm.wakeNote.tone;
  };

  return {
    get open() {
      return shown;
    },
    update(vm) {
      if (!vm) {
        if (shown) {
          shown = false;
          el.hidden = true;
          opts.root.dataset.sleeping = '';
          key = '';
        }
        return;
      }
      const k = JSON.stringify(vm);
      if (!shown) {
        shown = true;
        el.hidden = false;
        opts.root.dataset.sleeping = 'true';
      }
      if (k === key) return;
      key = k;
      render(vm);
    },
  };
}
