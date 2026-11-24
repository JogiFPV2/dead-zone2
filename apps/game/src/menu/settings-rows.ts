/** Content rows of each Ustawienia tab over a draft of the settings (pure, no DOM). */
import type { Action } from '../input/actions.js';
import { keyLabel } from '../hud/key-label.js';
import { percent } from '../audio/mix.js';
import {
  GRAPHICS_STYLES,
  NOISE_DISPLAYS,
  TOUCH_MODES,
  VIEW_DISTANCE_SETTINGS,
  type GraphicsStyle,
  type NoiseDisplay,
  type Settings,
  type ViewDistance,
} from '../settings/schema.js';
import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP, snapUiScale } from '../ui/ui-scale.js';
import { sliderKey } from './menu-model.js';
import { changedLabel, changedSlots } from '../hud/layout/hud-layout-model.js';
import type { HudLayout } from '@deadzone/ui/settings';
import type { SettingsTab } from './settings-tabs.js';

export interface ChoiceOption {
  id: string;
  label: string;
}

export type SettingsRow =
  | { kind: 'header'; label: string; note?: string }
  | {
      kind: 'slider';
      id: SliderId;
      label: string;
      /** Track position 0..1. */
      value: number;
      note: string;
      /** Shown value when it is not the 0–100 of the track (Skala interfejsu: `90%`). */
      display?: string;
      /** Hint while focused (default `◀ ▶ ±5 · Shift ±1`). */
      keys?: string;
      /** Description under the label (Interfejs › Skala interfejsu). */
      hint?: string;
    }
  | { kind: 'toggle'; id: ToggleId; label: string; hint: string; on: boolean }
  | {
      kind: 'choice';
      id: ChoiceId;
      label: string;
      hint: string;
      options: readonly ChoiceOption[];
      value: string;
      /** Caption of the active option (default `AKTYWNY`). */
      activeLabel?: string;
      /** Card row: one line per option under the options, a warning note and a side preview. */
      card?: { legend: readonly (ChoiceOption & { text: string })[]; warn: string };
    }
  | { kind: 'info'; label: string; value: string; soon?: boolean }
  | {
      kind: 'button';
      id: ButtonId;
      label: string;
      hint: string;
      /** Second hint line (trusted HTML: static text + `<b>`). */
      state?: string;
      button: string;
      icon: string;
      accent?: boolean;
      disabled?: boolean;
    };

export type FocusableRow = Extract<SettingsRow, { id: string }>;
export const isFocusable = (r: SettingsRow): r is FocusableRow => 'id' in r;

type SliderId = 'master' | 'music' | 'effects' | 'ambience' | 'voice' | 'uiScale';
type VolumeId = Exclude<SliderId, 'uiScale'>;
type ToggleId =
  | 'menuMusic'
  | 'antialias'
  | 'showFps'
  | 'showZombieHp'
  | 'targetZombieHp'
  | 'revealMap'
  | 'tutorial';
type ChoiceId = 'style' | 'quality' | 'viewDistance' | 'noiseDisplay' | 'touchMode';
/** Rows with a button: the screen runs them (Edytuj HUD, Przywróć domyślny układ). */
export type ButtonId = 'editHud' | 'resetHud';

const TOUCH_MODE_OPTIONS: readonly ChoiceOption[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'touch', label: 'Dotyk' },
  { id: 'mouse', label: 'Mysz' },
];

const STYLE_LABELS: Record<GraphicsStyle, string> = {
  classic: 'Klasyczny',
  outline: 'Kontury',
  pixel: 'Pixel',
  'pixel-fine': 'Pikselowy ostry',
  painted: 'Malowany',
};
const STYLES: readonly ChoiceOption[] = GRAPHICS_STYLES.map((id) => ({
  id,
  label: STYLE_LABELS[id],
}));
/**
 * „Styl grafiki”: the four looks of the low-poly world (post-process, switched live) and the
 * realistic PBR pilot (render/real, its own pipeline without that pass; applied on reload).
 * One choice over two fields: `graphics.style` and `graphics.renderStyle`.
 */
const STYLE_OPTIONS: readonly ChoiceOption[] = [...STYLES, { id: 'real', label: 'Realistyczny' }];
const styleValue = (g: Settings['graphics']): string =>
  g.renderStyle === 'real' ? 'real' : g.style;
/** „Profil renderowania” = devicePixelRatio cap. */
const QUALITY: readonly (ChoiceOption & { cap: number })[] = [
  { id: 'low', label: 'Niski', cap: 1 },
  { id: 'mid', label: 'Średni', cap: 1.5 },
  { id: 'high', label: 'Wysoki', cap: 2 },
];
/** „Zasięg widzenia” = chunk streaming preset (world/streaming/rings.ts, same as `?view=`). */
const VIEW_LABELS: Record<ViewDistance, string> = {
  low: 'Niski',
  medium: 'Średni',
  high: 'Wysoki',
};
const VIEW: readonly ChoiceOption[] = VIEW_DISTANCE_SETTINGS.map((id) => ({
  id,
  label: VIEW_LABELS[id],
}));
/** „Pokazuj hałas” (HUD v2 spec „Okrąg hałasu”, settings-noise.png). */
const NOISE_LABELS: Record<NoiseDisplay, string> = {
  off: 'Wył.',
  loud: 'Tylko głośne',
  always: 'Zawsze',
};
const NOISE: readonly ChoiceOption[] = NOISE_DISPLAYS.map((id) => ({
  id,
  label: NOISE_LABELS[id],
}));
const NOISE_LEGEND: readonly (ChoiceOption & { text: string })[] = [
  { id: 'off', label: 'Wył.', text: 'brak okręgu' },
  {
    id: 'loud',
    label: 'Tylko głośne',
    text: 'od 10 m: bieg, wyważanie, rozbita szyba, barykadowanie, strzał, silnik',
  },
  { id: 'always', label: 'Zawsze', text: 'także chodzenie, skradanie, przeszukiwanie, jedzenie' },
];
const qualityOf = (cap: number): string =>
  QUALITY.reduce((best, q) => (Math.abs(q.cap - cap) < Math.abs(best.cap - cap) ? q : best)).id;

const VOLUMES: readonly { id: VolumeId; label: string; note: string }[] = [
  { id: 'master', label: 'Główna', note: '' },
  { id: 'music', label: 'Muzyka', note: '' },
  { id: 'effects', label: 'Efekty', note: 'broń, kroki, zombie' },
  { id: 'ambience', label: 'Otoczenie', note: 'wiatr, deszcz, miasto' },
  { id: 'voice', label: 'Głosy/UI', note: 'dialogi, kliknięcia' },
];

const CONTROLS: readonly [string, readonly Action[], string?][] = [
  ['Ruch', ['moveUp', 'moveLeft', 'moveDown', 'moveRight']],
  ['Bieg', ['sprint']],
  ['Skradanie', ['crouch']],
  ['Przeskok (płot, okno)', ['vault']],
  ['Obrót kamery', ['rotateCameraLeft', 'rotateCameraRight']],
  ['Atak / odepchnięcie', ['primaryAction', 'secondaryAction']],
  ['Interakcja / przeładuj', ['interact', 'reload']],
  ['Ekwipunek / warsztat', ['inventory', 'crafting']],
  ['Sen / telewizor', ['sleep', 'watchTv']],
  ['Szybkie sloty', ['quickslot1', 'quickslot5'], '–'],
  ['Pauza / podpowiedzi', ['pause', 'toggleHints']],
  ['Następny cel', ['targetNext']],
];

export interface RowContext {
  /** „Teraz gra” track title for the menu music hint. */
  trackTitle: string;
  /** Canvas size for „Rozdzielczość”. */
  viewport: { width: number; height: number };
  /** „Edytuj HUD” works only in the game (the pause menu), not in the main menu. */
  hudEditor?: boolean;
  /** Draft HUD layout (PlayerSettings `hud`, saved apart from `Settings`). */
  hudLayout?: HudLayout;
}

/** Rows of `tab` for the draft `d`. */
export function settingsRows(tab: SettingsTab, d: Settings, ctx: RowContext): SettingsRow[] {
  switch (tab) {
    case 'account':
      // Ustawienia › Konto has its own panel (account-panel.ts), no rows.
      return [];
    case 'graphics':
      return [
        { kind: 'header', label: 'Grafika', note: 'Q / E lub ← → na zakładkach' },
        {
          kind: 'choice',
          id: 'style',
          label: 'Styl grafiki',
          hint: 'Realistyczny: tekstury PBR (pilot) · działa po ponownym wczytaniu gry',
          options: STYLE_OPTIONS,
          value: styleValue(d.graphics),
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
          kind: 'choice',
          id: 'viewDistance',
          label: 'Zasięg widzenia',
          hint: 'Jak daleko świat się wczytuje i rysuje · niżej = więcej FPS',
          options: VIEW,
          value: d.graphics.viewDistance,
        },
        uiScaleRow(d.graphics.uiScale),
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
        {
          kind: 'choice',
          id: 'touchMode',
          label: 'Tryb sterowania',
          hint: 'Auto wykrywa telefon lub tablet · zmiana po ponownym wejściu do gry',
          options: TOUCH_MODE_OPTIONS,
          value: d.input.touchMode,
        },
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
    case 'interface': {
      const changed = ctx.hudLayout ? changedSlots(ctx.hudLayout).length : 0;
      return [
        { kind: 'header', label: 'Układ HUD' },
        {
          kind: 'button',
          id: 'editHud',
          label: 'Układ HUD',
          hint: 'Przeciągnij elementy, zmień ich rozmiar i przezroczystość.',
          state: `Teraz: <b>${changed ? 'własny' : 'domyślny'}</b>${changed ? ` (${changedLabel(changed)})` : ''}${ctx.hudEditor ? '' : ' · edycja w trakcie gry'}`,
          button: 'EDYTUJ HUD',
          icon: 'edit',
          accent: true,
          disabled: !ctx.hudEditor,
        },
        {
          ...uiScaleRow(d.graphics.uiScale),
          hint: 'Globalnie, mnoży rozmiar każdego elementu HUD. Ten sam suwak co w zakładce Grafika.',
          note: '60–120%',
        } as SettingsRow,
        {
          kind: 'button',
          id: 'resetHud',
          label: 'Resetuj układ',
          hint: 'Wraca do układu domyślnego. Skala interfejsu zostaje.',
          button: 'PRZYWRÓĆ DOMYŚLNY UKŁAD',
          icon: 'reset',
          disabled: changed === 0,
        },
        { kind: 'header', label: 'Informacje na ekranie' },
        {
          kind: 'choice',
          id: 'noiseDisplay',
          label: 'Pokazuj hałas',
          hint: 'Okrąg wokół postaci: jak daleko słychać Twoją ostatnią akcję.',
          options: NOISE,
          value: d.interface.noiseDisplay,
          activeLabel: 'AKTYWNE',
          card: {
            legend: NOISE_LEGEND,
            warn: 'Okrąg pokazuje zasięg na otwartej przestrzeni. Ściany i piętra go skracają.',
          },
        },
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
        {
          kind: 'toggle',
          id: 'tutorial',
          label: 'Samouczek',
          hint: 'Podpowiedzi dla nowego gracza. Włączenie od nowa pokazuje je jeszcze raz.',
          on: d.interface.tutorial,
        },
        {
          kind: 'toggle',
          id: 'revealMap',
          label: 'Odkryj całą mapę (test)',
          hint: 'Odsłania mgłę na dużej mapie (M). Tylko do testów; zapis zostaje odkryty.',
          on: d.interface.revealMap,
        },
      ];
    }
  }
}

/** Track position 0..1 of a UI scale 0.6–1.2. */
const uiScaleTrack = (scale: number): number =>
  (scale - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN);

function uiScaleRow(scale: number): SettingsRow {
  return {
    kind: 'slider',
    id: 'uiScale',
    label: 'Skala interfejsu',
    value: uiScaleTrack(scale),
    display: `${Math.round(scale * 100)}%`,
    note: 'HUD, mapy, ekwipunek, menu',
    keys: '◀ ▶ ±5 %',
  };
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
    case 'revealMap':
      return { ...d, interface: { ...d.interface, revealMap: !d.interface.revealMap } };
    case 'tutorial':
      return { ...d, interface: { ...d.interface, tutorial: !d.interface.tutorial } };
  }
}

/** Sets choice `id` to option `value` (unknown options are ignored). */
export function chooseRow(d: Settings, id: ChoiceId, value: string): Settings {
  if (id === 'style') {
    if (value === 'real') return { ...d, graphics: { ...d.graphics, renderStyle: 'real' } };
    const style = GRAPHICS_STYLES.find((s) => s === value);
    return style ? { ...d, graphics: { ...d.graphics, style, renderStyle: 'default' } } : d;
  }
  if (id === 'noiseDisplay') {
    const noiseDisplay = NOISE_DISPLAYS.find((v) => v === value);
    return noiseDisplay ? { ...d, interface: { ...d.interface, noiseDisplay } } : d;
  }
  if (id === 'touchMode') {
    const touchMode = TOUCH_MODES.find((v) => v === value);
    return touchMode ? { ...d, input: { ...d.input, touchMode } } : d;
  }
  if (id === 'viewDistance') {
    const viewDistance = VIEW_DISTANCE_SETTINGS.find((v) => v === value);
    return viewDistance ? { ...d, graphics: { ...d.graphics, viewDistance } } : d;
  }
  const q = QUALITY.find((o) => o.id === value);
  return q ? { ...d, graphics: { ...d.graphics, pixelRatioCap: q.cap } } : d;
}

/** Sets slider `id` to `v` (0..1). */
export function setSlider(d: Settings, id: SliderId, v: number): Settings {
  if (id === 'uiScale') {
    const t = Math.min(1, Math.max(0, v));
    const uiScale = snapUiScale(UI_SCALE_MIN + t * (UI_SCALE_MAX - UI_SCALE_MIN));
    return uiScale === d.graphics.uiScale ? d : { ...d, graphics: { ...d.graphics, uiScale } };
  }
  return { ...d, audio: { ...d.audio, [id]: Math.min(1, Math.max(0, v)) } };
}

/** ←/→ (or Home/End) on a focused row; the draft unchanged when the row does not react. */
export function adjustRow(
  d: Settings,
  row: FocusableRow,
  key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
  fine: boolean,
): Settings {
  if (row.kind === 'slider' && row.id === 'uiScale') {
    const cur = d.graphics.uiScale;
    const next =
      key === 'Home'
        ? UI_SCALE_MIN
        : key === 'End'
          ? UI_SCALE_MAX
          : cur + (key === 'ArrowLeft' ? -UI_SCALE_STEP : UI_SCALE_STEP);
    return setSlider(d, 'uiScale', uiScaleTrack(snapUiScale(next)));
  }
  if (row.kind === 'slider') {
    const v = sliderKey(row.value, key, fine);
    return v === undefined ? d : setSlider(d, row.id, v);
  }
  if (row.kind === 'button') return d;
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
