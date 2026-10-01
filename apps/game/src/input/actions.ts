/** Game actions; bindings map physical inputs to these (never to letters). */
export const ACTIONS = [
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
  'sprint',
  'crouch',
  'rotateCameraLeft',
  'rotateCameraRight',
  'zoomIn',
  'zoomOut',
  'interact',
  'primaryAction',
  'secondaryAction',
  'reload',
  'quickslot1',
  'quickslot2',
  'quickslot3',
  'quickslot4',
  'quickslot5',
  'inventory',
  'crafting',
  'map',
  'pause',
  'toggleHints',
] as const;

export type Action = (typeof ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(ACTIONS);
export const isAction = (s: string): s is Action => ACTION_SET.has(s);

/**
 * A physical input as a string (persistable, comparable):
 * - keyboard: `KeyboardEvent.code` (layout-independent), e.g. `KeyW`, `Digit1`, `ShiftLeft`;
 * - mouse buttons: `Mouse0` (left) … `Mouse4`;
 * - wheel: `WheelUp` / `WheelDown`.
 */
export type InputCode = string;

export const mouseCode = (button: number): InputCode => `Mouse${button}`;
export const wheelCode = (deltaY: number): InputCode => (deltaY < 0 ? 'WheelUp' : 'WheelDown');

const CODE_RE = /^(Mouse[0-4]|Wheel(Up|Down)|(?!Mouse|Wheel)[A-Z][A-Za-z0-9]{1,24})$/;
export const isInputCode = (s: unknown): s is InputCode => typeof s === 'string' && CODE_RE.test(s);

export const isWheel = (code: InputCode): boolean => code === 'WheelUp' || code === 'WheelDown';
