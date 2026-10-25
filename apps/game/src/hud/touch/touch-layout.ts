/** Touch HUD rectangles (CSS px from the safe-area corner) shared by touch.css and its tests. */

/** Mini minimap, top-left under the HP bar (touch.css `.dz-g--minimap`). */
export const TOUCH_MINIMAP = { left: 8, top: 40, size: 120 } as const;

/** Fullscreen-map button right of the mini minimap. */
export const TOUCH_MAP_FULL = {
  left: TOUCH_MINIMAP.left + TOUCH_MINIMAP.size + 6,
  top: TOUCH_MINIMAP.top,
  size: 44,
} as const;

/** The joystick zone starts under the minimap and its floor badge (touch.css `.dz-touch__move`). */
export const TOUCH_MOVE_TOP = TOUCH_MINIMAP.top + TOUCH_MINIMAP.size + 12;

/** Vertical camera zoom slider at the right edge: under the top bar, above the thumb buttons. */
export const TOUCH_ZOOM = { right: 8, top: 60, width: 44, bottom: 196 } as const;
