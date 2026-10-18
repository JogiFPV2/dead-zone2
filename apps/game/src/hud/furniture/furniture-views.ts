import { itemImage } from '../item-icons.js';
import { furnIcon, type FurnIcon } from './furniture-icons.js';
import type {
  FridgeVM,
  FurnMenuVM,
  FurnPill,
  FurnRowVM,
  SleepChoiceVM,
  WatchVM,
} from './furniture-model.js';

/** HTML builders of the furniture UI (mockups furn-context / furn-fridge / furn-vhs / furn-sleep). */

export const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export const keyChip = (k: string): string => `<span class="dz-fm__key">${esc(k)}</span>`;

const itemIcon = (def: string, size: number, fallback: FurnIcon): string => {
  const url = itemImage(def);
  return url
    ? `<img class="dz-fm__img" src="${esc(url)}" width="${size}" height="${size}" alt="">`
    : furnIcon(fallback, size - 6);
};

const pillHtml = (p: FurnPill): string =>
  `<span class="dz-fm__pill" data-t="${p.tone}">${furnIcon(p.icon, 12)}${esc(p.text)}</span>`;

export interface MenuKeys {
  run: string;
  close: string;
}

/** Context menu (furn-context.png): header, pills, rows; `sel` = keyboard row. */
export function menuHtml(m: FurnMenuVM, sel: number, keys: MenuKeys): string {
  const rows = m.rows
    .map((r, i) => {
      const extras = r.extras
        .map((e) => `<span class="dz-fm__x" data-t="${e.tone}">${esc(e.text)}</span>`)
        .join('');
      const right = r.enabled
        ? `<span class="dz-fm__hint">${esc(r.right)}</span>`
        : `<span class="dz-fm__why">${r.reasonIcon ? furnIcon(r.reasonIcon, 12) : ''}<span>${esc(r.right)}</span></span>`;
      const run = i === sel && r.enabled && !r.submenu ? keyChip(keys.run) : '';
      // Odds / noise on a second line under the label (chance, break, injury, noise).
      const sub = extras ? `<span class="dz-fm__xs">${extras}</span>` : '';
      return `<div class="dz-fm__row" role="menuitem" data-i="${i}" data-sel="${i === sel}" data-off="${!r.enabled}" aria-disabled="${!r.enabled}" data-x="${!!extras}">${furnIcon(r.icon, 15)}<span class="dz-fm__lbl"><span class="dz-fm__lt">${esc(r.label)}</span>${sub}</span>${right}${run}</div>`;
    })
    .join('');
  const pills = m.pills.length
    ? `<div class="dz-fm__pills">${m.pills.map(pillHtml).join('')}</div>`
    : '';
  return `<div class="dz-fm__mh">${furnIcon(m.icon, 15)}<b>${esc(m.title.toUpperCase())}</b>${m.dist ? `<span class="dz-fm__muted">${esc(m.dist)}</span>` : ''}<span class="dz-fm__grow"></span><span class="dz-fm__type">${esc(m.typeId)}</span></div>
${pills}<div class="dz-fm__rows">${rows}</div>
<div class="dz-fm__mf">${keyChip('↑↓')} wybierz ${keyChip(keys.run)} wykonaj ${keyChip('→')} podmenu ${keyChip(keys.close)}</div>`;
}

/** Submenu (›): VHS tapes from the inventory or grouped actions (`lockpick:<id>`). */
export function subHtml(row: FurnRowVM, sel: number): string {
  const kids = row.children ?? [];
  const tapes = row.id === 'insert-tape';
  const list = kids
    .map((r, i) => {
      const icon = r.def ? itemIcon(r.def, 26, tapes ? 'tape' : row.icon) : furnIcon(row.icon, 18);
      const detail = r.enabled
        ? `<span>${esc(r.detail)}</span>`
        : `<span class="dz-fm__why">${esc(r.why ?? '')}</span>`;
      return `<div class="dz-fm__tape" role="menuitem" data-i="${i}" data-sel="${i === sel}" data-off="${!r.enabled}" data-watched="${r.watched ?? false}">${icon}<span class="dz-fm__tt"><b>${esc(r.label)}</b>${detail}</span></div>`;
    })
    .join('');
  return `<div class="dz-fm__mh">${furnIcon(tapes ? 'tape' : row.icon, 15)}<b>${esc(row.subTitle ?? row.label.toUpperCase())}</b>${tapes ? '<span class="dz-fm__muted">z ekwipunku</span>' : ''}</div>
<div class="dz-fm__rows">${list || `<div class="dz-fm__empty">${tapes ? 'Brak kaset w ekwipunku' : 'Brak'}</div>`}</div>
${row.subNote ? `<div class="dz-fm__mf dz-fm__mf--note">${esc(row.subNote)}</div>` : ''}`;
}

/** Fridge window (furn-fridge.png, right panel; freezer section feature-gated). */
export function fridgeHtml(
  f: FridgeVM,
  keys: { take: string; trash: string; close: string },
): string {
  const pills = f.pills.map(pillHtml).join('');
  const pct = f.capacity.max ? Math.min(1, f.capacity.used / f.capacity.max) : 0;
  const rows = f.rows
    .map((r) => {
      const fresh = r.fresh
        ? `<span class="dz-ff__bar" data-t="${r.fresh.tone}"><i style="width:${(r.fresh.pct * 100).toFixed(0)}%"></i></span><span class="dz-ff__fl" data-t="${r.fresh.tone}">${esc(r.fresh.label)}</span>`
        : '<span class="dz-ff__bar dz-ff__bar--none"></span><span class="dz-ff__fl">—</span>';
      return `<div class="dz-ff__row" data-id="${r.id}" title="${esc(f.spoilNote)}">${itemIcon(r.def, 22, 'box')}<span class="dz-ff__name">${esc(r.name)}</span><span class="dz-ff__n">${r.count}</span><span class="dz-ff__w">${esc(r.weight)}</span>${fresh}</div>`;
    })
    .join('');
  return `<div class="dz-ff__head">${furnIcon('fridge', 16)}<b>${esc(f.title.toUpperCase())}</b>${f.dist ? `<span class="dz-fm__muted">${esc(f.dist)}</span>` : ''}<span class="dz-fm__grow"></span><button type="button" class="dz-ff__x" data-act="close">${keyChip(keys.close)}</button></div>
${pills ? `<div class="dz-ff__pills">${pills}</div>` : ''}
<div class="dz-ff__cap"><span>Pojemność</span><span class="dz-ff__capbar"><i style="width:${(pct * 100).toFixed(1)}%"></i></span><b>${esc(f.capacity.label)}</b></div>
<div class="dz-ff__cols"><span></span><span>NAZWA</span><span>IL.</span><span>WAGA</span><span>ŚWIEŻOŚĆ</span></div>
<div class="dz-ff__sec">${furnIcon('fridge', 13)}<b>${esc(f.section)}</b><span class="dz-fm__muted">${esc(f.spoilNote)}</span></div>
<div class="dz-ff__rows">${rows || '<div class="dz-fm__empty">Pusto</div>'}</div>
<div class="dz-ff__foot"><button type="button" class="dz-ff__btn" data-act="take">WEŹ WSZYSTKO ${keyChip(keys.take)}</button><button type="button" class="dz-ff__btn" data-act="trash" ${f.rotten.length ? '' : 'disabled'}>WYRZUĆ ZEPSUTE ${keyChip(keys.trash)}</button><span class="dz-fm__grow"></span><span class="dz-fm__muted">LPM na wierszu: weź</span></div>`;
}

/** Watching panel (furn-vhs.png, „STAN A · KASETA VHS”; radio / generator feature-gated). */
export function watchHtml(w: WatchVM, stopKey: string): string {
  const skills = w.skills
    .map(
      (s) =>
        `<div class="dz-ftv__skill">${furnIcon('tape', 16)}<div class="dz-ftv__sm"><div class="dz-ftv__st"><b>${esc(s.name)}</b>${s.level !== undefined ? `<span class="dz-fm__muted">&nbsp;· poz. ${s.level}</span>` : ''}<span class="dz-fm__grow"></span><b class="dz-ftv__xp">${esc(s.xp)}</b></div><span class="dz-ftv__sbar"><i style="width:${(s.pct * 100).toFixed(0)}%"></i></span><small>${esc(w.note)}</small></div></div>`,
    )
    .join('');
  const fx = w.effects
    .map(
      (e) =>
        `<div class="dz-ftv__fx">${furnIcon(e.icon, 13)}<span>${esc(e.label)}</span><span class="dz-fm__grow"></span><b data-up="${e.up}">${furnIcon(e.up ? 'arrowUp' : 'arrowDown', 11)}${esc(e.value)}</b></div>`,
    )
    .join('');
  return `<div class="dz-ftv__top">${furnIcon('tape', 22)}<div class="dz-ftv__tt"><span class="dz-ftv__kick">${esc(w.kicker)}</span><b>${esc(w.title)}</b></div></div>
<div class="dz-ftv__prog"><span>${esc(w.elapsed)}</span><span class="dz-ftv__bar"><i style="width:${(w.pct * 100).toFixed(1)}%"></i></span><span>${esc(w.total)}</span></div>
${skills || `<div class="dz-ftv__note">${esc(w.note)}</div>`}
<div class="dz-ftv__fxs">${fx}</div>
<div class="dz-ftv__foot"><button type="button" class="dz-ftv__stop" data-act="stop">PRZERWIJ ${keyChip(stopKey)}</button><span class="dz-fm__muted">ruch lub atak zombie przerywa · XP przepada</span></div>`;
}

const pctLabel = (x: number): string => `${Math.round(x * 100)}%`;

/** Sleep choice (furn-sleep.png; the length row is feature-gated). */
export function sleepHtml(v: SleepChoiceVM, keys: { run: string; close: string }): string {
  const cards = v.cards
    .map(
      (c) =>
        `<div class="dz-fs__card" data-cur="${c.current}" data-av="${c.available}">${furnIcon(c.surface === 'bed' ? 'bed' : c.surface === 'sofa' ? 'sofa' : 'floor', 20)}<div class="dz-fs__cn"><b>${esc(c.name)}</b><span>${esc(c.note)}</span></div>
<div class="dz-fs__q"><span>Jakość</span><span class="dz-fs__qb"><i style="width:${pctLabel(c.quality)}"></i></span><b>${pctLabel(c.quality)}</b></div>
<div class="dz-fs__q"><span>Odpoczynek max</span><span class="dz-fm__grow"></span><b>${c.cap}</b></div></div>`,
    )
    .join('');
  const rows = v.rows
    .map(
      (r) =>
        `<div class="dz-fs__row">${furnIcon(r.icon, 13)}<span>${esc(r.label)}</span><span class="dz-fm__grow"></span><b data-t="${r.tone ?? ''}">${esc(r.value)}</b></div>`,
    )
    .join('');
  const blocked = v.blocked
    ? `<div class="dz-fs__blocked">${furnIcon('zombie', 16)}<div><b>${esc(v.blocked)}</b>${v.blockedNote ? `<span>${esc(v.blockedNote)}</span>` : ''}</div></div>`
    : '';
  return `<div class="dz-fs__head">${furnIcon('moon', 18)}<b>${esc(v.title)}</b><span class="dz-fm__grow"></span><span class="dz-fm__muted">teraz <b>${esc(v.now)}</b></span></div>
<div class="dz-fs__label">JAKOŚĆ SNU · ZALEŻY OD MEBLA</div>
<div class="dz-fs__cards">${cards}</div>
<div class="dz-fs__rows">${rows}</div>
${blocked}
<div class="dz-fs__foot"><button type="button" class="dz-fs__go" data-act="sleep" ${v.canSleep ? '' : 'disabled'}>${furnIcon('moon', 14)}ŚPIJ ${keyChip(keys.run)}</button><button type="button" class="dz-fs__cancel" data-act="cancel">ANULUJ ${keyChip(keys.close)}</button><span class="dz-fm__grow"></span><span class="dz-fm__muted">Esc w trakcie snu = obudź się</span></div>`;
}
