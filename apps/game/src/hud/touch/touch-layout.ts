/**
 * Touch HUD rectangles shared by touch.css and its tests (mobile HUD spec, 844×390 reference).
 * Offsets are CSS px added to the safe-area variables, which are at least TOUCH_SAFE_MIN − offset.
 */

/** Spec minimum insets: 47 L/R, 8 top, 21 bottom (= element offset + `--dz-safe-*` floor). */
export const TOUCH_SAFE_MIN = { l: 39, r: 39, t: 2, b: 3 } as const;

/** Mini minimap 96×96 under the HP bar (screen x 47, y 28). */
export const TOUCH_MINIMAP = { left: 8, top: 26, size: 96 } as const;

/** ⛶ full-map button: third in the +, −, ⛶ column right of the minimap (44 hit). */
export const TOUCH_MAP_FULL = {
  left: TOUCH_MINIMAP.left + TOUCH_MINIMAP.size + 4,
  top: TOUCH_MINIMAP.top + 2 * 44,
  size: 44,
} as const;

/** The joystick zone starts under the minimap column (touch.css `.dz-touch__move`). */
export const TOUCH_MOVE_TOP = TOUCH_MAP_FULL.top + TOUCH_MAP_FULL.size + 14;

/** Vertical camera zoom slider at the right edge: screen y 62–186 (spec), above SKRAD. */
export const TOUCH_ZOOM = { right: 8, top: 60, width: 44, bottom: 201 } as const;

/** Spec: the player's rectangle stays empty (fractions of the viewport). */
export const TOUCH_CENTER_FREE = { x0: 0.4, x1: 0.6, y0: 0.3, y1: 0.75 } as const;
