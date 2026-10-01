/** Pure helpers of the main menu (deadzone-menu-spec §3–§5). */

export interface NavItem {
  readonly disabled?: boolean;
}

/** Next enabled index from `from` by `delta` (±1), wrapping; `from` itself if none is enabled. */
export function stepFocus(items: readonly NavItem[], from: number, delta: 1 | -1): number {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + delta * k) % n) + n) % n;
    if (!items[i]?.disabled) return i;
  }
  return from;
}

/** First enabled index (default focus). */
export function firstEnabled(items: readonly NavItem[]): number {
  const i = items.findIndex((it) => !it.disabled);
  return i < 0 ? 0 : i;
}

/** Slider keys: ←/→ ±5, Shift ±1, Home/End 0/100. Value in 0..1; `undefined` = not a slider key. */
export function sliderKey(v: number, key: string, shift: boolean): number | undefined {
  const step = shift ? 0.01 : 0.05;
  const pct = Math.round(v * 100) / 100;
  let next: number;
  if (key === 'ArrowLeft' || key === 'KeyA') next = pct - step;
  else if (key === 'ArrowRight' || key === 'KeyD') next = pct + step;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = 1;
  else return undefined;
  return Math.round(Math.min(1, Math.max(0, next)) * 100) / 100;
}

/** Slider value from a pointer x over a track [left, left + width]. */
export function sliderAt(clientX: number, left: number, width: number): number {
  if (width <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, (clientX - left) / width)) * 100) / 100;
}

/** UI scale like the HUD: the layout is authored for 1920×1080. */
export function menuScale(width: number, height: number): number {
  return Math.max(0.5, Math.min(2, width / 1920, height / 1080));
}
