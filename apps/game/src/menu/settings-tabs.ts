/** Ustawienia: tabs and keyboard routing (deadzone-menu-spec §5–§6), pure. */

export const SETTINGS_TABS = [
  { id: 'graphics', label: 'Grafika' },
  { id: 'audio', label: 'Dźwięk' },
  { id: 'controls', label: 'Sterowanie' },
  { id: 'gameplay', label: 'Rozgrywka' },
  { id: 'interface', label: 'Interfejs' },
] as const;

/** Ustawienia › Konto (account-settings.png): last, only when online accounts exist. */
export const ACCOUNT_TAB = { id: 'account', label: 'Konto' } as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'] | typeof ACCOUNT_TAB.id;

export interface TabDef {
  readonly id: SettingsTab;
  readonly label: string;
}

/** Tabs of the screen: the account tab is appended when the game has online accounts. */
export const settingsTabs = (withAccount: boolean): readonly TabDef[] =>
  withAccount ? [...SETTINGS_TABS, ACCOUNT_TAB] : SETTINGS_TABS;

/** Tab `delta` steps from `tab`, wrapping. */
export function stepTab(
  tab: SettingsTab,
  delta: number,
  tabs: readonly TabDef[] = SETTINGS_TABS,
): SettingsTab {
  const n = tabs.length;
  const i = Math.max(
    0,
    tabs.findIndex((t) => t.id === tab),
  );
  return tabs[(((i + delta) % n) + n) % n]!.id;
}

export const isSettingsTab = (
  s: string | undefined,
  tabs: readonly TabDef[] = SETTINGS_TABS,
): s is SettingsTab => tabs.some((t) => t.id === s);

/** Where the settings focus is: the tab strip or a content row (index into focusable rows). */
export type SettingsFocus = { zone: 'tabs' } | { zone: 'row'; index: number };

export type SettingsKeyCommand =
  | { type: 'tab'; delta: 1 | -1 }
  | { type: 'focus'; delta: 1 | -1 }
  | { type: 'adjust'; dir: 1 | -1; fine: boolean }
  | { type: 'jump'; to: 0 | 1 }
  | { type: 'activate' }
  | { type: 'apply' }
  | { type: 'back' };

export interface KeyMods {
  ctrl: boolean;
  shift: boolean;
}

/**
 * Key → command. Q/E and Ctrl+Tab (Shift = back) always switch tabs; ←/→ switch tabs when the
 * focus is on the tab strip, else adjust the focused row. `undefined` = not ours.
 */
export function settingsKey(
  code: string,
  mods: KeyMods,
  focus: SettingsFocus,
): SettingsKeyCommand | undefined {
  if (code === 'KeyQ') return { type: 'tab', delta: -1 };
  if (code === 'KeyE') return { type: 'tab', delta: 1 };
  if (code === 'Tab' && mods.ctrl) return { type: 'tab', delta: mods.shift ? -1 : 1 };
  if (code === 'Tab') return { type: 'focus', delta: mods.shift ? -1 : 1 };
  if (code === 'ArrowDown' || code === 'KeyS') return { type: 'focus', delta: 1 };
  if (code === 'ArrowUp' || code === 'KeyW') return { type: 'focus', delta: -1 };
  const lr =
    code === 'ArrowLeft' || code === 'KeyA' ? -1 : code === 'ArrowRight' || code === 'KeyD' ? 1 : 0;
  if (lr !== 0) {
    return focus.zone === 'tabs'
      ? { type: 'tab', delta: lr }
      : { type: 'adjust', dir: lr, fine: mods.shift };
  }
  if (code === 'Home' || code === 'End') return { type: 'jump', to: code === 'Home' ? 0 : 1 };
  if (code === 'Space') return { type: 'activate' };
  if (code === 'Enter' || code === 'NumpadEnter') return { type: 'apply' };
  if (code === 'Escape') return { type: 'back' };
  return undefined;
}

/** Moves the focus through [tabs, row 0 … row n-1], wrapping. */
export function stepSettingsFocus(
  focus: SettingsFocus,
  delta: 1 | -1,
  rows: number,
): SettingsFocus {
  const slots = rows + 1;
  const cur = focus.zone === 'tabs' ? 0 : focus.index + 1;
  const next = (((cur + delta) % slots) + slots) % slots;
  return next === 0 ? { zone: 'tabs' } : { zone: 'row', index: next - 1 };
}
