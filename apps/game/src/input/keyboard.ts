import type { MoveKeys } from './move-direction.js';

const CODES: Record<string, keyof MoveKeys> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

/** Tracks WASD held state (by physical key code). Clears on window blur. */
export function trackMoveKeys(target: Window = window): { keys: MoveKeys; dispose: () => void } {
  const keys: MoveKeys = { up: false, down: false, left: false, right: false };
  const set = (e: KeyboardEvent, down: boolean): void => {
    const k = CODES[e.code];
    if (k) keys[k] = down;
  };
  const onDown = (e: KeyboardEvent): void => set(e, true);
  const onUp = (e: KeyboardEvent): void => set(e, false);
  const onBlur = (): void => {
    keys.up = keys.down = keys.left = keys.right = false;
  };
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return {
    keys,
    dispose: () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
