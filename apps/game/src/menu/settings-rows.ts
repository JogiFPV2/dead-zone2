/** Content rows of each Ustawienia tab over a draft of the settings (pure, no DOM). */
import type { Action } from '../input/actions.js';
import { keyLabel } from '../hud/key-label.js';
import { percent } from '../audio/mix.js';
import { GRAPHICS_STYLES, type GraphicsStyle, type Settings } from '../settings/schema.js';
import { sliderKey } from './menu-model.js';
import type { SettingsTab } from './settings-tabs.js';

export interface ChoiceOption {
  id: string;
  label: string;
}

export type SettingsRow =
  | { kind: 'header'; label: string; note?: string }
  | { kind: 'slider'; id: SliderId; label: string; value: number; note: string }
  | { kind: 'toggle'; id: ToggleId; label: string; hint: string; on: boolean }
  | {
      kind: 'choice';
      id: ChoiceId;
      label: string;
      hint: string;
      options: readonly ChoiceOption[];
      value: string;
    }
  | { kind: 'info'; label: string; value: string; soon?: boolean };

export type FocusableRow = Extract<SettingsRow, { id: string }>;
export const isFocusable = (r: SettingsRow): r is FocusableRow => 'id' in r;

type SliderId = 'master' | 'music' | 'effects' | 'ambience' | 'voice';
type ToggleId = 'menuMusic' | 'antialias' | 'showFps' | 'showZombieHp' | 'targetZombieHp';
type ChoiceId = 'style' | 'quality';

const STYLE_LABELS: Record<GraphicsStyle, string> = {
  classic: 'Klasyczny',
  outline: 'Kontury',
  pixel: 'Pixel',
  'pixel-fine': 'Pikselowy ostry',
};
const STYLES: readonly ChoiceOption[] = GRAPHICS_STYLES.map((id) => ({
  id,
  label: STYLE_LABELS[id],
}));
/** „Profil renderowania” = devicePixelRatio cap. */
const QUALITY: readonly (ChoiceOption & { cap: number })[] = [
  { id: 'low', label: 'Niski', cap: 1 },
  { id: 'mid', label: 'Średni', cap: 1.5 },
  { id: 'high', label: 'Wysoki', cap: 2 },
];
const qualityOf = (cap: number): string =>
  QUALITY.reduce((best, q) => (Math.abs(q.cap - cap) < Math.abs(best.cap - cap) ? q : best)).id;

const VOLUMES: readonly { id: SliderId; label: string; note: string }[] = [
  { id: 'master', label: 'Główna', note: '' },
  { id: 'music', label: 'Muzyka', note: '' },
  { id: 'effects', label: 'Efekty', note: 'broń, kroki, zombie' },
  { id: 'ambience', label: 'Otoczenie', note: 'wiatr, deszcz, miasto' },
  { id: 'voice', label: 'Głosy/UI', note: 'dialogi, kliknięcia' },
];

const CONTROLS: readonly [string, readonly Action[], string?][] = [
  ['Ruch', ['moveUp', 'moveLeft', 'moveDown', 'moveRight']],
  ['Bieg / skradanie', ['sprint', 'crouch']],
  ['Przeskok (płot, okno)', ['vault']],
  ['Obrót kamery', ['rotateCameraLeft', 'rotateCameraRight']],
  ['Atak / odepchnięcie', ['primaryAction', 'secondaryAction']],
  ['Interakcja / przeładuj', ['interact', 'reload']],
  ['Ekwipunek / warsztat', ['inventory', 'crafting']],
  ['Sen / telewizor', ['sleep', 'watchTv']],
  ['Szybkie sloty', ['quickslot1', 'quickslot5'], '–'],
  ['Pauza / podpowiedzi', ['pause', 'toggleHints']],
];

export interface RowContext {
  /** „Teraz gra” track title for the menu music hint. */
  trackTitle: string;
  /** Canvas size for „Rozdzielczość”. */
  viewport: { width: number; height: number };
}

/** Rows of `tab` for the draft `d`. */
export function settingsRows(tab: SettingsTab, d: Settings, ctx: RowContext): SettingsRow[] {
  switch (tab) {
    case 'graphics':
      return [
        { kind: 'header', label: 'Grafika', note: 'Q / E lub ← → na zakładkach' },
        {
          kind: 'choice',
          id: 'style',
          label: 'Styl grafiki',
          hint: 'Zmień wygląd świata bez zmiany zapisu.',
          options: STYLES,
          value: d.graphics.style,
        },
        {
          kind: 'choice',
          id: 'quality',
          label: 'Profil renderowania',
          hint: 'Limit gęstości pikseli · zapisywany, w grze wkrótce',
          options: QUALITY,
          value: qualityOf(d.graphics.pixelRatioCap),
        },
        {
          kind: 'info',
          label: 'Rozdzielczość',
          value: `${ctx.viewport.width} × ${ctx.viewport.height}`,
        },
        {
          kind: 'toggle',
          id: 'antialias',
          label: 'Wygładzanie krawędzi',
          hint: 'Zapisywane · w grze wkrótce',
          on: d.graphics.antialias,
        },
        {
          kind: 'toggle',
          id: 'showFps',
          label: 'Licznik FPS',
          hint: 'Zapisywane · w grze wkrótce',
          on: d.graphics.showFps,
        },
      ];
    case 'audio':
      return [
        { kind: 'header', label: 'Głośność', note: 'zmiany słychać od razu' },
        ...VOLUMES.map((v): SettingsRow => ({ kind: 'slider', ...v, value: d.audio[v.id] })),
        { kind: 'header', label: 'Muzyka' },
        {
          kind: 'toggle',
          id: 'menuMusic',
          label: 'Muzyka w menu',
          hint: `Ścieżka gry (CC0) w menu głównym · teraz: „${ctx.trackTitle}”`,
          on: d.audio.menuMusic,
        },
        { kind: 'info', label: 'Własna muzyka (YouTube)', value: 'Wkrótce', soon: true },
      ];
    case 'controls':
      return [
        { kind: 'header', label: 'Sterowanie', note: 'zmiana klawiszy wkrótce' },
        ...CONTROLS.map(([label, actions]): SettingsRow => ({
          kind: 'info',
          label,
          value: actions.map((a) => keyLabel(d.input.bindings[a][0] ?? '') || '–').join(' · '),
        })),
      ];
    case 'gameplay':
      return [
        { kind: 'header', label: 'Rozgrywka' },
        { kind: 'info', label: 'Pauza (Esc)', value: 'Zatrzymuje symulację w grze jednoosobowej' },
        { kind: 'info', label: 'Zapis świata', value: 'Jeden zapis, nadpisywany przy wyjściu' },
        { kind: 'info', label: 'Śmierć', value: 'Jedno życie: postać ginie na zawsze' },
      ];
    case 'interface':
      return [
        { kind: 'header', label: 'Interfejs' },
        {
          kind: 'toggle',
          id: 'showZombieHp',
          label: 'Pokazuj życie zombie',
          hint: 'Mały pasek nad każdym rannym zombie (wył.: tylko cel)',
          on: d.interface.showZombieHp,
        },
        {
          kind: 'toggle',
          id: 'targetZombieHp',
          label: 'Cel: Shift + LPM',
          hint: 'Shift + LPM na zombie pokazuje dymek z jego życiem',
          on: d.interface.targetZombieHp,
        },
      ];
  }
}

/** Value shown next to a slider (0–100). */
export const sliderPercent = percent;

/** Toggle `id` in the draft. */
export function toggleRow(d: Settings, id: ToggleId): Settings {
  switch (id) {
    case 'menuMusic':
      return { ...d, audio: { ...d.audio, menuMusic: !d.audio.menuMusic } };
    case 'antialias':
      return { ...d, graphics: { ...d.graphics, antialias: !d.graphics.antialias } };
    case 'showFps':
      return { ...d, graphics: { ...d.graphics, showFps: !d.graphics.showFps } };
    case 'showZombieHp':
      return { ...d, interface: { ...d.interface, showZombieHp: !d.interface.showZombieHp } };
    case 'targetZombieHp':
      return { ...d, interface: { ...d.interface, targetZombieHp: !d.interface.targetZombieHp } };
  }
}

/** Sets choice `id` to option `value` (unknown options are ignored). */
export function chooseRow(d: Settings, id: ChoiceId, value: string): Settings {
  if (id === 'style') {
    const style = GRAPHICS_STYLES.find((s) => s === value);
    return style ? { ...d, graphics: { ...d.graphics, style } } : d;
  }
  const q = QUALITY.find((o) => o.id === value);
  return q ? { ...d, graphics: { ...d.graphics, pixelRatioCap: q.cap } } : d;
}

/** Sets slider `id` to `v` (0..1). */
export function setSlider(d: Settings, id: SliderId, v: number): Settings {
  return { ...d, audio: { ...d.audio, [id]: Math.min(1, Math.max(0, v)) } };
}

/** ←/→ (or Home/End) on a focused row; the draft unchanged when the row does not react. */
export function adjustRow(
  d: Settings,
  row: FocusableRow,
  key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
  fine: boolean,
): Settings {
  if (row.kind === 'slider') {
    const v = sliderKey(row.value, key, fine);
    return v === undefined ? d : setSlider(d, row.id, v);
  }
  if (row.kind === 'toggle') {
    if (key === 'Home' || key === 'End') return d;
    return toggleRow(d, row.id);
  }
  const i = row.options.findIndex((o) => o.id === row.value);
  const n = row.options.length;
  const next =
    key === 'Home' ? 0 : key === 'End' ? n - 1 : (i + (key === 'ArrowLeft' ? -1 : 1) + n) % n;
  return chooseRow(d, row.id, row.options[next]!.id);
}

/** Space / click on a focused row: toggle, next choice; sliders do nothing. */
export function activateRow(d: Settings, row: FocusableRow): Settings {
  if (row.kind === 'toggle') return toggleRow(d, row.id);
  if (row.kind === 'choice') return adjustRow(d, row, 'ArrowRight', false);
  return d;
}

/** Whether the draft differs from the stored settings in the fields this screen edits. */
export function isDirty(draft: Settings, stored: Settings): boolean {
  const pick = (s: Settings) => [s.audio, s.graphics, s.interface];
  return JSON.stringify(pick(draft)) !== JSON.stringify(pick(stored));
}
