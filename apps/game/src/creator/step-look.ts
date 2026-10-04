import type { ContentIndex } from '@deadzone/sim';
import { HEAD_PRESETS, type ClothSlot, type MeshRef, type PartColors } from './appearance-map.js';
import {
  CLOTH_PALETTE,
  HAIR_PALETTE,
  SKIN_PALETTE,
  clothOptions,
  creation,
  type CreatorDraft,
} from './creator-model.js';
import { esc, keyCap, svg } from './html.js';

export type LookSlot = 'head' | ClothSlot;
export type ColorTarget = 'skin' | 'hair' | ClothSlot;

export interface LookCtx {
  c: ContentIndex;
  d: CreatorDraft;
  /** Thumbnail URL of an option ('' while not rendered). */
  thumb(ref: MeshRef, colors: PartColors): string;
  hex(palette: string, color: string): string | undefined;
}

interface TileOpt {
  id: string;
  label: string;
  ref: MeshRef;
  colors: PartColors;
}

/** Options of a look slot with the colors they are previewed in. */
export function lookOptions(x: LookCtx, slot: LookSlot): TileOpt[] {
  if (slot === 'head') {
    const hair = x.hex(HAIR_PALETTE, x.d.hairColor);
    return HEAD_PRESETS.map((h) => ({
      id: h.id,
      label: h.label,
      ref: h.mesh,
      colors: hair ? { primary: hair } : {},
    }));
  }
  const ch = x.d[slot];
  const pr = x.hex(CLOTH_PALETTE, ch.primary);
  const se = x.hex(CLOTH_PALETTE, ch.secondary);
  const colors: PartColors = { ...(pr ? { primary: pr } : {}), ...(se ? { secondary: se } : {}) };
  return clothOptions(x.c, slot).map((o) => ({ id: o.part, label: o.label, ref: o.mesh, colors }));
}

export const selectedId = (d: CreatorDraft, slot: LookSlot): string =>
  slot === 'head' ? d.head : d[slot].part;

/** Three visible tiles around the selected one (carousel window). */
export function tileWindow(n: number, sel: number, visible = 3): number[] {
  if (n <= visible) return [...Array(n).keys()];
  const start = Math.min(Math.max(0, sel - 1), n - visible);
  return [...Array(visible).keys()].map((i) => start + i);
}

function tiles(x: LookCtx, slot: LookSlot, title: string): string {
  const opts = lookOptions(x, slot);
  const selId = selectedId(x.d, slot);
  const sel = Math.max(
    0,
    opts.findIndex((o) => o.id === selId),
  );
  const shown = tileWindow(opts.length, sel)
    .map((i) => {
      const o = opts[i]!;
      const on = i === sel;
      const url = x.thumb(o.ref, o.colors);
      return `<button type="button" class="dzc-tilebox" data-act="pick" data-slot="${slot}" data-id="${esc(o.id)}">
<span class="dzc-tile${on ? ' dzc-tile--sel' : ''}">${url ? `<img src="${url}" alt="">` : ''}</span>
<span class="dzc-tcap${on ? ' dzc-tcap--sel' : ''}">${esc(o.label)}</span></button>`;
    })
    .join('');
  const arrow = (dir: -1 | 1) =>
    `<button type="button" class="dzc-arr" data-act="cycle" data-slot="${slot}" data-dir="${dir}" aria-label="${dir < 0 ? 'Poprzedni' : 'Następny'}">${svg(dir < 0 ? 'chevl' : 'chevr')}</button>`;
  return `<div class="dzc-col dzc-gap8"><div class="dzc-row"><span class="dzc-lbl dzc-grow">${title}</span><span class="dzc-count">${sel + 1} / ${opts.length}</span></div>
<div class="dzc-row dzc-gap8 dzc-top">${arrow(-1)}${shown}${arrow(1)}</div></div>`;
}

const colorName = (id: string): string => id.replace(/-/g, ' ');

function swatches(
  x: LookCtx,
  target: ColorTarget,
  title: string,
  palette: string,
  sel: string,
  disabled = false,
): string {
  const colors = x.c.palettes.get(palette)?.colors ?? [];
  const list = colors
    .map(
      (col) =>
        `<button type="button" class="dzc-sw${col.id === sel ? ' dzc-sw--sel' : ''}" style="background:${col.hex}" data-act="color" data-target="${target}" data-id="${esc(col.id)}" title="${esc(colorName(col.id))}"${disabled ? ' disabled' : ''}></button>`,
    )
    .join('');
  return `<div class="dzc-col dzc-gap8${disabled ? ' dzc-dim' : ''}"><div class="dzc-row"><span class="dzc-lbl dzc-grow">${title}</span><span class="dzc-swname">${disabled ? '—' : esc(SWATCH_NAMES[sel] ?? colorName(sel))}</span></div><div class="dzc-row dzc-wrap dzc-gap6">${list}</div></div>`;
}

/** Polish names of palette colors (TEMPORARY, content has ids only). */
const SWATCH_NAMES: Record<string, string> = {
  porcelain: 'Porcelana',
  fair: 'Jasna',
  light: 'Ton 3',
  medium: 'Średnia',
  olive: 'Oliwkowa',
  tan: 'Opalona',
  brown: 'Brąz',
  dark: 'Ciemna',
  black: 'Czarne',
  'dark-brown': 'Ciemny brąz',
  chestnut: 'Kasztan',
  auburn: 'Rudawobrązowe',
  ginger: 'Rude',
  'dark-blond': 'Ciemny blond',
  blond: 'Blond',
  ash: 'Popielate',
  grey: 'Szary',
  charcoal: 'Grafit',
  slate: 'Łupek',
  'off-white': 'Złamana biel',
  navy: 'Granat',
  denim: 'Dżins',
  'faded-blue': 'Sprany niebieski',
  'army-green': 'Wojskowa zieleń',
  forest: 'Leśna zieleń',
  khaki: 'Khaki',
  rust: 'Rdza',
  maroon: 'Bordo',
  mustard: 'Musztarda',
};

export function renderLookLeft(x: LookCtx): string {
  const max = creation(x.c).name.maxLen;
  const input = (field: 'first' | 'last', value: string, placeholder: string, label: string) =>
    `<label class="dzc-input"><input data-act="name" data-field="${field}" maxlength="${max}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" spellcheck="false" autocomplete="off"><span class="dzc-count" data-name-count="${field}">${value.length}/${max}</span></label>`;
  return `<div class="dzc-hdr"><span class="dzc-htitle">TOŻSAMOŚĆ</span></div>
<div class="dzc-col dzc-gap8"><span class="dzc-lbl">IMIĘ I NAZWISKO</span>
<div class="dzc-row dzc-gap8">${input('first', x.d.firstName, 'Imię', 'Imię')}
<button type="button" class="dzc-btn dzc-btn--sec" data-act="random">${svg('dice', 18)} LOSUJ ${keyCap('R')}</button></div>
<div class="dzc-row dzc-gap8">${input('last', x.d.lastName, 'Nazwisko (opcjonalnie)', 'Nazwisko (opcjonalnie)')}</div></div>
<div class="dzc-sep"></div>
<div class="dzc-hdr"><span class="dzc-htitle">GŁOWA</span></div>
${tiles(x, 'head', 'TWARZ I FRYZURA')}
${tiles(x, 'top', 'OKRYCIE (KURTKA / BLUZA)')}`;
}

export function renderLookRight(x: LookCtx): string {
  const d = x.d;
  const bald = !HEAD_PRESETS.find((h) => h.id === d.head)?.hair;
  return `<div class="dzc-hdr"><span class="dzc-htitle">UBRANIE</span><button type="button" class="dzc-btn dzc-btn--sec dzc-btn--sm" data-act="random-outfit">${svg('dice', 16)} Losowy ubiór</button></div>
${tiles(x, 'bottom', 'SPODNIE')}
${tiles(x, 'shoes', 'BUTY')}
<div class="dzc-sep"></div>
<div class="dzc-hdr"><span class="dzc-htitle">KOLORY · PALETA</span><span class="dzc-hnote">stonowana paleta świata</span></div>
${swatches(x, 'skin', 'SKÓRA', creation(x.c).skinPalette ?? SKIN_PALETTE, d.skin)}
${swatches(x, 'hair', 'WŁOSY', HAIR_PALETTE, d.hairColor, bald)}
${swatches(x, 'top', 'OKRYCIE', CLOTH_PALETTE, d.top.primary)}
${swatches(x, 'bottom', 'SPODNIE', CLOTH_PALETTE, d.bottom.primary)}
${swatches(x, 'shoes', 'BUTY', CLOTH_PALETTE, d.shoes.primary)}`;
}
