import type { Action, InputCode } from '../input/actions.js';
import type { Bindings } from '../input/bindings.js';

const NAMED: Record<string, string> = {
  Escape: 'Esc',
  Space: 'Spacja',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Mouse0: 'LPM',
  Mouse1: 'ŚPM',
  Mouse2: 'PPM',
  Mouse3: 'M4',
  Mouse4: 'M5',
  WheelUp: 'Kółko ↑',
  WheelDown: 'Kółko ↓',
};

/** Short key name for the HUD: `KeyF` → `F`, `Digit1` → `1`, `ShiftLeft` → `Shift`. */
export function keyLabel(code: InputCode): string {
  const named = NAMED[code];
  if (named) return named;
  const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
  if (m?.[1]) return m[1];
  const side = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (side?.[1]) return side[1] === 'Control' ? 'Ctrl' : side[1];
  return code;
}

/** Label of an action's primary input, or `–` when unbound. */
export const actionKey = (b: Bindings, action: Action): string => {
  const code = b[action][0];
  return code ? keyLabel(code) : '–';
};

/** `WASD` when all four move keys are single letters/digits, else `W/A/S/D`-style joined labels. */
export function moveKeysLabel(b: Bindings): string {
  const keys = (['moveUp', 'moveLeft', 'moveDown', 'moveRight'] as const).map((a) =>
    actionKey(b, a),
  );
  return keys.every((k) => /^[A-Z0-9]$/.test(k)) ? keys.join('') : keys.join('/');
}

/** Label of an action's first keyboard input (skips mouse / wheel), or `–`. */
export const keyboardKey = (b: Bindings, action: Action): string => {
  const code = b[action].find((c) => !/^(Mouse|Wheel)/.test(c));
  return code ? keyLabel(code) : '–';
};
