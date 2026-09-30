/** Key-hint row (spec §3.11). */
import { tokens } from '../../tokens/tokens.generated.js';
import { ms } from '../../tokens/units.js';

export interface KeyHint {
  /** Key from the current binding (`WASD`, `Shift`). */
  key: string;
  label: string;
}

/** Spec §5 `HintsVM`. */
export interface HintsVM {
  items: readonly KeyHint[];
  visible: boolean;
}

/** Spec default row (keys from the default binding; Silnik passes the current one). */
export const DEFAULT_HINTS: readonly KeyHint[] = [
  { key: 'WASD', label: 'ruch' },
  { key: 'Shift', label: 'sprint' },
  { key: 'Ctrl', label: 'skradanie' },
  { key: 'Tab', label: 'ekwipunek' },
  { key: 'C', label: 'postać' },
  { key: 'M', label: 'mapa' },
  { key: 'Esc', label: 'menu' },
];

/** The row hides itself after this much play time (motion.hints.visible = 10 min). */
export const HINTS_VISIBLE_MS = ms(tokens.motion.hints.visible);

/** Settings value: `auto` = first 10 min, then hidden; F1 flips between on and off. */
export type HintsSetting = 'auto' | 'on' | 'off';

/** Whether the row shows, for a setting and the play time so far (ms, paused time excluded). */
export const hintsVisible = (setting: HintsSetting, playedMs: number): boolean =>
  setting === 'on' || (setting === 'auto' && playedMs < HINTS_VISIBLE_MS);

/** F1: from whatever is visible now to the opposite fixed setting. */
export const toggleHints = (setting: HintsSetting, playedMs: number): HintsSetting =>
  hintsVisible(setting, playedMs) ? 'off' : 'on';

export const HINT_SEPARATOR = ' · ';
