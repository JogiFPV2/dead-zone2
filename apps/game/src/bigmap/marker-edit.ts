import {
  MARKER_COLORS,
  MARKER_ICONS,
  MARKER_TEXT_MAX,
  MARKER_TEXT_MAX_UNITS,
  markerTextLength,
  markerHex,
  clampMarkerText,
  type MarkerDraft,
} from './bigmap-model.js';
import { MARKER_LABEL, bmIcon, markerGlyph } from './icons.js';

export interface MarkerEditHandlers {
  save(draft: MarkerDraft): void;
  /** USUŃ (an existing marker) or discard (a new one). */
  remove(): void;
  cancel(): void;
}

export interface MarkerEdit {
  readonly el: HTMLElement;
  open(o: { mode: 'new' | 'edit'; draft: MarkerDraft; info: string }): void;
  close(): void;
  readonly isOpen: boolean;
  /** Current icon / colour (pin preview). */
  readonly draft: MarkerDraft | undefined;
  place(x: number, y: number): void;
  save(): void;
  onChange?: (d: MarkerDraft) => void;
}

/** Marker edit panel, 318 px (bigmap-marker-edit.png). */
export function createMarkerEdit(h: MarkerEditHandlers): MarkerEdit {
  const el = document.createElement('div');
  el.className = 'dz-bm__edit';
  el.hidden = true;
  el.innerHTML = `
<div class="dz-bm__edit-head"><div><div class="dz-bm__edit-title"></div><div class="dz-bm__edit-info"></div></div><button class="dz-bm__ib dz-bm__edit-x">${bmIcon('x', 'var(--bm-n300)', 16)}</button></div>
<div class="dz-bm__sep dz-bm__sep--wide"></div>
<div class="dz-bm__h6">IKONA</div>
<div class="dz-bm__icons"></div>
<div class="dz-bm__h6 dz-bm__h6--gap">KOLOR</div>
<div class="dz-bm__colors"></div>
<div class="dz-bm__desc-head"><div class="dz-bm__h6">OPIS</div><div class="dz-bm__count"></div></div>
<input class="dz-bm__text" type="text" maxlength="${MARKER_TEXT_MAX_UNITS}" spellcheck="false" />
<label class="dz-bm__mini"><input type="checkbox" /><span class="dz-bm__bx"></span>pokaż na minimapie</label>
<div class="dz-bm__sep dz-bm__sep--wide"></div>
<div class="dz-bm__btns">
 <button class="dz-bm__btn dz-bm__btn--pri">${bmIcon('save', '#0E1113', 15)}ZAPISZ<span class="dz-bm__key dz-bm__key--acc">ENTER</span></button>
 <button class="dz-bm__btn dz-bm__btn--dan">${bmIcon('trash', 'var(--bm-dan-t)', 14)}USUŃ</button>
 <button class="dz-bm__btn dz-bm__btn--sec">ANULUJ<span class="dz-bm__key">ESC</span></button>
</div>`;
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const title = q('.dz-bm__edit-title');
  const info = q('.dz-bm__edit-info');
  const icons = q('.dz-bm__icons');
  const colors = q('.dz-bm__colors');
  const count = q('.dz-bm__count');
  const text = q<HTMLInputElement>('.dz-bm__text');
  const mini = q<HTMLInputElement>('.dz-bm__mini input');
  let draft: MarkerDraft | undefined;

  const render = () => {
    if (!draft) return;
    const d = draft;
    icons.innerHTML = '';
    for (const ic of MARKER_ICONS) {
      const b = document.createElement('button');
      b.className = `dz-bm__icon${ic === d.icon ? ' on' : ''}`;
      b.dataset.icon = ic;
      b.title = MARKER_LABEL[ic];
      b.innerHTML = bmIcon(
        markerGlyph(ic),
        ic === d.icon ? 'var(--bm-acc-hi)' : 'var(--bm-n300)',
        20,
        1.9,
      );
      b.addEventListener('click', () => set({ icon: ic }));
      icons.append(b);
    }
    colors.innerHTML = '';
    for (const c of MARKER_COLORS) {
      const b = document.createElement('button');
      b.className = `dz-bm__color${c === d.color ? ' on' : ''}`;
      b.style.background = markerHex(c);
      b.dataset.color = c;
      if (c === d.color) b.innerHTML = bmIcon('check', '#0E1113', 15, 3);
      b.addEventListener('click', () => set({ color: c }));
      colors.append(b);
    }
    count.textContent = `${markerTextLength(text.value)} / ${MARKER_TEXT_MAX}`;
    mini.checked = d.showOnMinimap;
    el.classList.toggle('mini-on', d.showOnMinimap);
  };
  const set = (p: Partial<MarkerDraft>) => {
    if (!draft) return;
    draft = { ...draft, ...p };
    render();
    api.onChange?.(draft);
  };
  text.addEventListener('input', () => {
    const v = clampMarkerText(text.value);
    if (v !== text.value) text.value = v;
    set({ text: v });
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      api.save();
    } else if (e.key === 'Escape') {
      // The game ignores keys typed into inputs, so Esc in the text field cancels here.
      e.preventDefault();
      e.stopPropagation();
      h.cancel();
    }
  });
  mini.addEventListener('change', () => set({ showOnMinimap: mini.checked }));
  q('.dz-bm__btn--pri').addEventListener('click', () => api.save());
  q('.dz-bm__btn--dan').addEventListener('click', () => h.remove());
  q('.dz-bm__btn--sec').addEventListener('click', () => h.cancel());
  q('.dz-bm__edit-x').addEventListener('click', () => h.cancel());
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  const api: MarkerEdit = {
    el,
    open(o) {
      draft = { ...o.draft };
      title.textContent = o.mode === 'new' ? 'NOWY ZNACZNIK' : 'EDYCJA ZNACZNIKA';
      info.textContent = o.info;
      text.value = draft.text;
      el.hidden = false;
      render();
      text.focus({ preventScroll: true });
    },
    close() {
      el.hidden = true;
      draft = undefined;
      text.blur();
    },
    get isOpen() {
      return !el.hidden;
    },
    get draft() {
      return draft;
    },
    place(x, y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    },
    save() {
      if (draft) h.save({ ...draft, text: clampMarkerText(text.value) });
    },
  };
  return api;
}
