import './vehicle-hud.css';
import { itemImage } from '../hud/item-icons.js';
import { vehIcon, type VehIcon } from './vehicle-icons.js';
import {
  hpColor,
  SECTION_TITLES,
  sectionSummary,
  type CarPanelVM,
  type MenuItemVM,
  type RejectToastVM,
  type RepairRowVM,
  type RepairSection,
} from './vehicle-model.js';

/** Screen anchor in CSS px of the HUD root. */
export interface Anchor {
  x: number;
  y: number;
}

export interface MenuVM extends Anchor {
  /** `SEDAN`. */
  title: string;
  /** `1,1 m`. */
  dist: string;
  chips: { icon: VehIcon; text: string; tone?: 'acc' | 'bad' }[];
  items: MenuItemVM[];
  sel: number;
  key: string;
}

export interface BarVM {
  label: string;
  sub: string;
  value: string;
  max: string;
  frac: number;
  /** Lighter level after the whole can (`alpha .32`). */
  ghost?: number;
  rate: string;
  color: string;
  /** Vehicle icon name or an item content id (`base:gas-can`, atlas image). */
  icon: string;
}

export interface RefuelVM {
  mode: 'car' | 'pump';
  title: string;
  sub: string;
  /** `ŹRÓDŁO` row: the can in hand (car) or the pump chips (pump). */
  source?: { item: string; label: string; detail: string };
  power?: 'powered' | 'manual' | undefined;
  powered: string;
  manual: string;
  bars: BarVM[];
  ghostNote?: string;
  left?: string;
  note?: string;
  full?: {
    title: string;
    total: string;
    steps: { label: string; detail: string; active: boolean }[];
  };
  buttons: { id: string; label: string; key?: string; reason?: string; primary?: boolean }[];
}

export interface RepairVM {
  sub: string;
  skill: string;
  rows: RepairRowVM[];
  sel: number;
  /** Selected part's HP colouring of the schematic (part → hp). */
  hp: Readonly<Record<string, number>>;
  example?: RepairRowVM;
  running?: { label: string; left: string };
}

export interface VehicleHudVM {
  panel?: CarPanelVM & {
    hints: boolean;
    keys: { engine: string; exit: string; horn: string; light: string };
  };
  menu?: MenuVM;
  toast?: RejectToastVM & Anchor & { good?: boolean };
  chip?: Anchor & { progress: number; text: string; sub?: string };
  refuel?: RefuelVM;
  repair?: RepairVM;
}

export interface VehicleHud {
  readonly el: HTMLElement;
  update(vm: VehicleHudVM): void;
  /** Menu row picked / hovered, a refuel or repair button, a repair row clicked. */
  onAction?: (kind: 'menu' | 'hover' | 'button' | 'row', id: string) => void;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

const key = (k: string): string => `<span class="dz-vh__key">${esc(k)}</span>`;

const icon = (name: string, size = 14): string => {
  const url = name.includes(':') ? itemImage(name) : undefined;
  if (url)
    return `<img class="dz-vh__img" src="${esc(url)}" width="${size + 6}" height="${size + 6}" alt="">`;
  return name.includes(':') ? vehIcon('fuel', size) : vehIcon(name as VehIcon, size);
};

function panelHtml(p: NonNullable<VehicleHudVM['panel']>): string {
  const ign =
    p.ignition === 'hotwired'
      ? `<span class="dz-vh__ign" data-t="hot" title="kable">${vehIcon('bolt', 13)}</span>`
      : `<span class="dz-vh__ign" data-t="${p.ignition}" title="zapłon">${vehIcon('key', 14)}</span>`;
  const lock = `<span class="dz-vh__lock" data-on="${p.locked}">${vehIcon(p.locked ? 'lock' : 'unlock', 13)}</span>`;
  const eng = `<span class="dz-vh__eng" data-t="${p.engine.tone}">${vehIcon('engine', 13)}${esc(p.engine.text)}</span>`;
  const hints = p.hints
    ? `<div class="dz-vh__hints">${key(p.keys.engine)} silnik ${key(p.keys.exit)} wysiądź</div>`
    : '';
  return `${hints}<div class="dz-vh__panel">
  <div class="dz-vh__r1"><span class="dz-vh__car">${vehIcon('car', 15)}</span><b>${esc(p.type)}</b><span class="dz-vh__seat">${esc(p.seat)}</span><span class="dz-vh__grow"></span>${ign}${lock}</div>
  <div class="dz-vh__r2"><span class="dz-vh__spd" data-rev="${p.speed.reverse}">${esc(p.speed.value)}</span><span class="dz-vh__kmh">km/h</span><span class="dz-vh__grow"></span>
    <div class="dz-vh__fuel" data-low="${p.fuel.low}"><div class="dz-vh__fl">${vehIcon('fuel', 11)}<span>PALIWO</span><span class="dz-vh__grow"></span><b>${esc(p.fuel.litres)}</b><span class="dz-vh__max"> / ${esc(p.fuel.max)} l</span></div>
    <div class="dz-vh__bar"><i style="width:${(p.fuel.frac * 100).toFixed(1)}%"></i><em></em></div></div></div>
  <div class="dz-vh__r3">${eng}<span class="dz-vh__grow"></span>${key(p.keys.horn)}<span class="dz-vh__k">klakson</span>${key(p.keys.light)}<span class="dz-vh__k" data-on="${p.headlights}">światła</span></div>
</div>`;
}

function menuHtml(m: MenuVM): string {
  const chips = m.chips
    .map(
      (c) =>
        `<span class="dz-vh__chip" data-t="${c.tone ?? ''}">${vehIcon(c.icon, 12)}${esc(c.text)}</span>`,
    )
    .join('');
  const rows = m.items
    .map((it, i) => {
      const right = it.reason
        ? `<span class="dz-vh__why">${esc(it.reason)}</span>`
        : `<span class="dz-vh__hint">${esc(it.hint)}</span>`;
      const sel = i === m.sel ? ' data-sel="true"' : '';
      const fk = i === m.sel && !it.reason ? key(m.key) : '';
      return `${it.divider ? '<div class="dz-vh__div"></div>' : ''}<div class="dz-vh__row" data-i="${i}"${sel}${it.reason ? ' data-off="true"' : ''}>${it.item && itemImage(it.item) ? icon(it.item, 14) : vehIcon(it.icon, 14)}<span class="dz-vh__lbl">${esc(it.label)}</span>${right}${fk}</div>`;
    })
    .join('');
  return `<div class="dz-vh__menu" style="left:${m.x}px;top:${m.y}px">
  <div class="dz-vh__mh">${vehIcon('car', 15)}<b>${esc(m.title)}</b><span class="dz-vh__muted">${esc(m.dist)}</span></div>
  <div class="dz-vh__chips">${chips}</div>
  <div class="dz-vh__rows">${rows}</div>
  <div class="dz-vh__mf">${key('↑↓')} wybierz ${key(m.key)} wykonaj ${key('Esc')} zamknij</div>
</div>`;
}

function toastHtml(t: NonNullable<VehicleHudVM['toast']>): string {
  return `<div class="dz-vh__toast" data-good="${t.good ?? false}" style="left:${t.x}px;top:${t.y}px">${vehIcon(t.good ? 'check' : 'key', 13)}<b>${esc(t.title)}</b>${t.text ? `<span>${esc(t.text)}</span>` : ''}</div>`;
}

const R = 11;
const C = 2 * Math.PI * R;
function chipHtml(c: NonNullable<VehicleHudVM['chip']>): string {
  const off = C * (1 - Math.max(0, Math.min(1, c.progress)));
  return `<div class="dz-vh__achip" style="left:${c.x}px;top:${c.y}px"><svg width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="${R}" class="dz-vh__trk"/><circle cx="14" cy="14" r="${R}" class="dz-vh__arc" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 14 14)"/></svg><span class="dz-vh__ctext">${vehIcon('fuel', 12)}<b>${esc(c.text)}</b>${c.sub ? ` ${esc(c.sub)}` : ''}</span></div>`;
}

function barHtml(b: BarVM): string {
  const ghost =
    b.ghost !== undefined
      ? `<s style="width:${(Math.min(1, b.ghost) * 100).toFixed(1)}%;background:${b.color}"></s>`
      : '';
  return `<div class="dz-vh__rb"><span class="dz-vh__rbi">${icon(b.icon, 18)}</span><div class="dz-vh__rbm">
   <div class="dz-vh__rbt"><b>${esc(b.label)}</b><span class="dz-vh__muted">${esc(b.sub)}</span><span class="dz-vh__grow"></span><span class="dz-vh__big">${esc(b.value)}</span><span class="dz-vh__muted"> / ${esc(b.max)}</span></div>
   <div class="dz-vh__bar2">${ghost}<i style="width:${(b.frac * 100).toFixed(1)}%;background:${b.color}"></i></div></div><span class="dz-vh__rate">${esc(b.rate)}</span></div>`;
}

function refuelHtml(r: RefuelVM): string {
  const head = `<div class="dz-vh__ph">${icon(r.mode === 'pump' ? 'pump' : 'fuel', 16)}<b>${esc(r.title)}</b><span class="dz-vh__muted">${esc(r.sub)}</span><span class="dz-vh__grow"></span>${key('Esc')}<span class="dz-vh__muted">${r.mode === 'pump' ? 'zamknij' : 'przerwij'}</span></div>`;
  let source = '';
  if (r.mode === 'car' && r.source) {
    source = `<div class="dz-vh__src"><span class="dz-vh__lab">ŹRÓDŁO</span>${icon(r.source.item, 14)}<b>${esc(r.source.label)}</b><span class="dz-vh__muted">${esc(r.source.detail)}</span></div>`;
  } else if (r.mode === 'pump') {
    const chip = (id: 'powered' | 'manual', ic: VehIcon, label: string, rate: string): string =>
      `<span class="dz-vh__pchip" data-on="${r.power === id}">${vehIcon(ic, 13)}<b>${label}</b><span class="dz-vh__grow"></span>${esc(rate)}</span>`;
    source = `<div class="dz-vh__src"><span class="dz-vh__lab">ŹRÓDŁO</span>${chip('powered', 'power', 'PRĄD', r.powered)}${chip('manual', 'crank', 'KORBA', r.manual)}</div>
<div class="dz-vh__note2">${r.power ? 'wyliczone z czasu akcji (sim nie wysyła źródła)' : 'źródło nieznane: wyjdzie po pierwszym napełnieniu'}</div>`;
  }
  const bars = r.bars.map(barHtml).join('');
  const ghost =
    r.ghostNote || r.left
      ? `<div class="dz-vh__gn"><i></i><span class="dz-vh__muted">${esc(r.ghostNote ?? '')}</span><span class="dz-vh__grow"></span>${r.left ? `<span class="dz-vh__muted">zostało</span> <b>${esc(r.left)}</b>` : ''}</div>`
      : '';
  const note = r.note ? `<div class="dz-vh__note">⚠ ${esc(r.note)}</div>` : '';
  const full = r.full
    ? `<div class="dz-vh__full"><div class="dz-vh__fh"><b>${esc(r.full.title)}</b><span class="dz-vh__grow"></span><span class="dz-vh__muted">${esc(r.full.total)}</span></div>${r.full.steps
        .map(
          (s, i) =>
            `<div class="dz-vh__step" data-on="${s.active}"><span>${i + 1}</span><span class="dz-vh__grow">${esc(s.label)}</span><span class="dz-vh__muted">${esc(s.detail)}</span></div>`,
        )
        .join('')}</div>`
    : '';
  const btns = r.buttons
    .map(
      (b) =>
        `<button type="button" class="dz-vh__btn" data-b="${esc(b.id)}"${b.primary ? ' data-primary="true"' : ''}${b.reason ? ' data-off="true" disabled' : ''}>${esc(b.label)}${b.key ? key(b.key) : ''}${b.reason ? `<span class="dz-vh__why">${esc(b.reason)}</span>` : ''}</button>`,
    )
    .join('');
  return `<div class="dz-vh__refuel" data-mode="${r.mode}">${head}${source}${bars}${ghost}${note}${full}<div class="dz-vh__btns">${btns}</div></div>`;
}

const SECTION_ICON: Record<RepairSection, VehIcon> = {
  engine: 'engine',
  tires: 'tire',
  body: 'body',
  windows: 'window',
  other: 'battery',
};

const rowIcon = (r: RepairRowVM): VehIcon =>
  r.key === 'battery' ? 'battery' : r.key === 'fuelTank' ? 'tank' : SECTION_ICON[r.section];

/** Atlas icon of a repair row's part (Designer's car icons); SVG for the rest. */
const ROW_ITEM: Partial<Record<RepairRowVM['section'], string>> = {
  engine: 'base:engine-parts',
  tires: 'base:car-tire',
  windows: 'base:car-window',
};
const rowImg = (r: RepairRowVM, size: number): string => {
  const item = r.part ? ROW_ITEM[r.section] : undefined;
  return item && itemImage(item) ? icon(item, size) : vehIcon(rowIcon(r), size);
};

function schematic(vm: RepairVM): string {
  const sel = vm.rows[vm.sel]?.key;
  const col = (k: string): string => {
    const hp = vm.hp[k];
    return hp === undefined ? '#5B6469' : hpColor(hp);
  };
  const part = (k: string, shape: string, extra = ''): string =>
    `<g data-part="${k}" ${k === sel ? 'class="dz-vh__sel"' : ''}>${shape.replace(/FILL/g, col(k))}${extra}</g>`;
  const broken = (k: string): string => ((vm.hp[k] ?? 100) <= 0 ? ' fill="url(#dzvh-hatch)"' : '');
  const pctLabel = (k: string, x: number, y: number, label: string, anchor: string): string =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" class="dz-vh__st" fill="${col(k)}">${label} ${vm.hp[k] ?? 100}%</text>`;
  return `<svg class="dz-vh__schem" width="300" height="350" viewBox="-50 0 300 350">
<defs><pattern id="dzvh-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#3a1714"/><line x1="0" y1="0" x2="0" y2="6" stroke="#C8453C" stroke-width="3"/></pattern></defs>
${part('bodyFront', '<path d="M40 70 Q40 22 100 18 Q160 22 160 70 Z" fill="FILL" fill-opacity=".28" stroke="FILL" stroke-width="2"/>')}
${part('engine', '<rect x="66" y="34" width="68" height="30" rx="3" fill="none" stroke="FILL" stroke-width="2" stroke-dasharray="4 3"/><text x="100" y="53" text-anchor="middle" class="dz-vh__st" fill="FILL">SILNIK</text>')}
${part('bodyRear', '<path d="M40 268 L160 268 Q160 318 100 322 Q40 318 40 268 Z" fill="FILL" fill-opacity=".28" stroke="FILL" stroke-width="2"/><text x="100" y="304" text-anchor="middle" class="dz-vh__st" fill="#9AA3A7">BAGAŻNIK</text>')}
${part('bodyLeft', '<rect x="40" y="72" width="20" height="194" fill="FILL" fill-opacity=".28" stroke="FILL" stroke-width="2"/>')}
${part('bodyRight', '<rect x="140" y="72" width="20" height="194" fill="FILL" fill-opacity=".28" stroke="FILL" stroke-width="2"/>')}
<rect x="62" y="72" width="76" height="194" fill="#1b2023" stroke="#2C3337"/>
<text x="100" y="172" text-anchor="middle" class="dz-vh__st" fill="#5B6469">WNĘTRZE</text>
${part('windowFront', `<path d="M66 78 L134 78 L128 104 L72 104 Z" fill="#4FA8C8" fill-opacity=".45" stroke="FILL" stroke-width="1.5"${broken('windowFront')}/>`)}
${part('windowRear', `<path d="M72 236 L128 236 L134 260 L66 260 Z" fill="#4FA8C8" fill-opacity=".45" stroke="FILL" stroke-width="1.5"${broken('windowRear')}/>`)}
${part('windowLeft', `<rect x="64" y="112" width="6" height="110" fill="#4FA8C8" fill-opacity=".45" stroke="FILL" stroke-width="1.5"${broken('windowLeft')}/>`)}
${part('windowRight', `<rect x="130" y="112" width="6" height="110" fill="#4FA8C8" fill-opacity=".45" stroke="FILL" stroke-width="1.5"${broken('windowRight')}/>`)}
${part('tireFL', '<rect x="22" y="84" width="16" height="40" rx="4" fill="FILL" stroke="#0E1113"/>')}
${part('tireFR', '<rect x="162" y="84" width="16" height="40" rx="4" fill="FILL" stroke="#0E1113"/>')}
${part('tireRL', '<rect x="22" y="214" width="16" height="40" rx="4" fill="FILL" stroke="#0E1113"/>')}
${part('tireRR', '<rect x="162" y="214" width="16" height="40" rx="4" fill="FILL" stroke="#0E1113"/>')}
${pctLabel('tireFL', 14, 108, 'LP', 'end')}${pctLabel('tireFR', 186, 108, 'PP', 'start')}${pctLabel('tireRL', 14, 238, 'LT', 'end')}${pctLabel('tireRR', 186, 238, 'PT', 'start')}
</svg>`;
}

function repairHtml(vm: RepairVM): string {
  const sections: RepairSection[] = ['engine', 'tires', 'body', 'windows', 'other'];
  const rows = sections
    .map((sec) => {
      const list = vm.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.section === sec);
      const sum = sectionSummary(vm.rows, sec);
      const items = list
        .map(({ r, i }) => {
          const bar =
            r.hp !== undefined
              ? `<span class="dz-vh__hpb"><i style="width:${r.hp}%;background:${hpColor(r.hp)}"></i></span><span class="dz-vh__hpn">${r.hp}%</span>`
              : '<span class="dz-vh__hpb dz-vh__hpb--na"></span><span class="dz-vh__hpn">—</span>';
          const na = r.state === 'na' ? '<span class="dz-vh__na">BRAK W API</span>' : '';
          return `<div class="dz-vh__rrow" data-row="${i}" data-state="${r.state}"${i === vm.sel ? ' data-sel="true"' : ''}>${rowImg(r, 14)}<span class="dz-vh__rl">${esc(r.label)}${r.note ? ` · ${esc(r.note)}` : ''}${na}</span>${bar}<span class="dz-vh__rs">${esc(r.status)}</span></div>`;
        })
        .join('');
      return `<div class="dz-vh__sec"><b>${SECTION_TITLES[sec]}</b><span class="dz-vh__grow"></span><span class="dz-vh__muted">${esc(sum)}</span></div>${items}`;
    })
    .join('');
  const r = vm.rows[vm.sel];
  let detail = '';
  if (r) {
    const reqs = r.reqs
      .map(
        (q) =>
          `<div class="dz-vh__req" data-ok="${q.ok}">${q.item && itemImage(q.item) ? icon(q.item, 14) : vehIcon(q.kind === 'tool' ? 'wrench' : q.kind === 'part' ? 'tire' : 'gauge', 14)}<div class="dz-vh__grow"><b>${esc(q.label)}</b><span class="dz-vh__muted">${esc(q.sub)}</span></div><span class="dz-vh__ok">${q.ok ? `${vehIcon('check', 12)} MASZ` : 'BRAK'}</span></div>`,
      )
      .join('');
    const result =
      r.state === 'na'
        ? `<div class="dz-vh__res"><span class="dz-vh__muted">Sim nie ma tej części (propozycja dla Symulacji).</span></div>`
        : `<div class="dz-vh__res"><div><span>Czas</span><b>${r.sec} s</b></div><div><span>Stan po naprawie</span><span class="dz-vh__hpb"><i style="width:${r.after}%;background:${hpColor(r.after)}"></i></span><b>${r.after}%</b><span class="dz-vh__muted">${r.replace ? 'wymiana' : 'naprawa'}</span></div><div><span>Doświadczenie</span><b class="dz-vh__acc">+${r.xp} XP</b><span class="dz-vh__muted">Mechanika</span></div></div>`;
    const ex = vm.example;
    const example = ex
      ? `<div class="dz-vh__ex"><div class="dz-vh__exh">${rowImg(ex, 14)}<b>${esc(ex.label.toUpperCase())} · ${ex.hp ?? 0}%</b><span class="dz-vh__grow"></span><span class="dz-vh__muted">brakuje</span></div><div class="dz-vh__exr">${ex.reqs
          .map(
            (q) =>
              `<span data-ok="${q.ok}">${esc(q.ok ? q.label.replace(/^[^:]+: /, '') + ' ✓' : q.short)}</span>`,
          )
          .join(
            '',
          )}</div><div class="dz-vh__muted">NAPRAW jest szare, powód jak w menu.</div></div>`
      : '';
    const hpText = r.hp !== undefined ? `${r.hp}%${r.note ? ` · ${r.note}` : ''}` : 'BRAK W API';
    detail = `<div class="dz-vh__ph">${rowImg(r, 15)}<b>${esc(r.label.toUpperCase())}</b><span class="dz-vh__grow"></span><span style="color:${r.hp !== undefined ? hpColor(r.hp) : '#5B6469'}">${esc(hpText)}</span></div>
<div class="dz-vh__det">${schematic(vm)}<div class="dz-vh__side"><div class="dz-vh__lab">WYMAGANIA</div>${reqs || '<div class="dz-vh__muted">—</div>'}<div class="dz-vh__lab">WYNIK</div>${result}</div></div>${example}`;
  }
  const running = vm.running
    ? `<span class="dz-vh__run">${esc(vm.running.label)} · ${esc(vm.running.left)}</span>`
    : '';
  const canFix = r?.state === 'ready';
  return `<div class="dz-vh__scrim"></div><div class="dz-vh__stage">
<div class="dz-vh__win dz-vh__win--l"><div class="dz-vh__ph">${vehIcon('wrench', 15)}<b>STAN AUTA</b><span class="dz-vh__muted">${esc(vm.sub)}</span><span class="dz-vh__grow"></span><b>${esc(vm.skill)}</b></div>
<div class="dz-vh__cols"><span>CZĘŚĆ</span><span class="dz-vh__grow"></span><span class="dz-vh__c2">STAN</span><span class="dz-vh__c3">NAPRAWA</span></div><div class="dz-vh__rlist">${rows}</div></div>
<div class="dz-vh__win dz-vh__win--r">${detail}<div class="dz-vh__grow"></div><div class="dz-vh__btns"><button type="button" class="dz-vh__btn" data-b="repair" data-primary="true"${canFix ? '' : ' data-off="true" disabled'}>NAPRAW${key('F')}</button><button type="button" class="dz-vh__btn" data-b="next">NASTĘPNA CZĘŚĆ${key('Tab')}</button>${running}<span class="dz-vh__grow"></span>${key('Esc')}<span class="dz-vh__muted">zamknij</span></div></div>
<div class="dz-vh__keys">${key('↑↓')} część ${key('F')} napraw ${key('Tab')} następna do naprawy ${key('Esc')} zamknij</div>
</div>`;
}

/** DOM of the vehicle UI (car panel, F menu, toasts, refuel panel, repair window). */
export function createVehicleHud(): VehicleHud {
  const el = document.createElement('div');
  el.className = 'dz-vh';
  const parts = {
    panel: document.createElement('div'),
    menu: document.createElement('div'),
    toast: document.createElement('div'),
    chip: document.createElement('div'),
    refuel: document.createElement('div'),
    repair: document.createElement('div'),
  };
  parts.panel.className = 'dz-vh__dock';
  parts.repair.className = 'dz-vh__modal';
  parts.refuel.className = 'dz-vh__rstage';
  el.append(parts.panel, parts.refuel, parts.chip, parts.toast, parts.menu, parts.repair);
  const last: Record<keyof typeof parts, string> = {
    panel: '',
    menu: '',
    toast: '',
    chip: '',
    refuel: '',
    repair: '',
  };
  const set = (k: keyof typeof parts, html: string): void => {
    if (last[k] === html) return;
    last[k] = html;
    parts[k].innerHTML = html;
    parts[k].hidden = html === '';
  };
  const hud: VehicleHud = {
    el,
    update(vm) {
      set('panel', vm.panel ? panelHtml(vm.panel) : '');
      set('menu', vm.menu ? menuHtml(vm.menu) : '');
      set('toast', vm.toast ? toastHtml(vm.toast) : '');
      set('chip', vm.chip ? chipHtml(vm.chip) : '');
      set('refuel', vm.refuel ? refuelHtml(vm.refuel) : '');
      set('repair', vm.repair ? repairHtml(vm.repair) : '');
    },
  };
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.dz-vh__row');
    if (row?.dataset.i) hud.onAction?.('menu', row.dataset.i);
    const btn = t.closest<HTMLElement>('.dz-vh__btn');
    if (btn?.dataset.b && !btn.dataset.off) hud.onAction?.('button', btn.dataset.b);
    const rr = t.closest<HTMLElement>('.dz-vh__rrow');
    if (rr?.dataset.row) hud.onAction?.('row', rr.dataset.row);
    const part = t.closest<SVGElement>('[data-part]');
    if (part?.dataset.part) hud.onAction?.('row', `part:${part.dataset.part}`);
  });
  el.addEventListener('pointerover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.dz-vh__row');
    if (row?.dataset.i) hud.onAction?.('hover', row.dataset.i);
  });
  return hud;
}
