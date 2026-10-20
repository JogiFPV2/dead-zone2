/** A touch that lifts within this time … */
export const TAP_MAX_MS = 300;
/** … and moved less than this (CSS px) is a tap; anything else is a drag. */
export const TAP_MAX_PX = 10;

/** Holding a touch still this long is a long press (mockup: context menu after 450 ms). */
export const LONG_PRESS_MS = 450;

export type GestureEvent =
  | { type: 'tap'; x: number; y: number }
  | { type: 'longPress'; x: number; y: number }
  /** Two fingers: `scale` = finger distance now / at the previous event (> 1 = spread = zoom in). */
  | { type: 'pinch'; scale: number };

interface Touch {
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  moved: boolean;
  long: boolean;
}

/**
 * Tap / drag / pinch from raw touch pointers (no DOM: feed `down` / `move` / `up`). A touch that
 * was ever part of a pinch, or travelled ≥ TAP_MAX_PX, or lasted > TAP_MAX_MS is not a tap.
 */
export class TouchGestures {
  private readonly touches = new Map<number, Touch>();
  private pinchDist: number | undefined;
  /** No tap until every finger has lifted after a pinch. */
  private pinched = false;

  constructor(private readonly emit: (e: GestureEvent) => void) {}

  get count(): number {
    return this.touches.size;
  }

  down(id: number, x: number, y: number, t: number): void {
    this.touches.set(id, { x0: x, y0: y, x, y, t0: t, moved: false, long: false });
    if (this.touches.size >= 2) {
      this.pinched = true;
      this.pinchDist = this.distance();
    }
  }

  move(id: number, x: number, y: number): void {
    const p = this.touches.get(id);
    if (!p) return;
    p.x = x;
    p.y = y;
    if (Math.hypot(x - p.x0, y - p.y0) >= TAP_MAX_PX) p.moved = true;
    if (this.touches.size >= 2 && this.pinchDist !== undefined) {
      const d = this.distance();
      if (d > 0 && this.pinchDist > 0 && d !== this.pinchDist) {
        this.emit({ type: 'pinch', scale: d / this.pinchDist });
        this.pinchDist = d;
      }
    }
  }

  up(id: number, t: number): void {
    const p = this.touches.get(id);
    if (!p) return;
    this.touches.delete(id);
    if (this.touches.size < 2) this.pinchDist = undefined;
    const tap = !this.pinched && !p.moved && !p.long && t - p.t0 <= TAP_MAX_MS;
    if (this.touches.size === 0) this.pinched = false;
    if (tap) this.emit({ type: 'tap', x: p.x, y: p.y });
  }

  /**
   * Time passes (call from a timer / frame): a single still touch held LONG_PRESS_MS becomes a
   * long press (once); it is then never a tap.
   */
  poll(t: number): void {
    if (this.touches.size !== 1 || this.pinched) return;
    for (const p of this.touches.values()) {
      if (p.long || p.moved || t - p.t0 < LONG_PRESS_MS) continue;
      p.long = true;
      this.emit({ type: 'longPress', x: p.x, y: p.y });
    }
  }

  /** A cancelled touch (system gesture, lost capture): forgotten, never a tap. */
  cancel(id: number): void {
    this.touches.delete(id);
    if (this.touches.size < 2) this.pinchDist = undefined;
    if (this.touches.size === 0) this.pinched = false;
  }

  /** True while the touch has not (yet) become a drag or a pinch. */
  isTapCandidate(id: number): boolean {
    const p = this.touches.get(id);
    return !!p && !p.moved && !this.pinched;
  }

  private distance(): number {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}

/** Pinch scale → wheel delta for `zoomFromWheel` (`factor = step^(-deltaY / 100)`). */
export const pinchToWheel = (scale: number, step: number): number =>
  scale > 0 && step > 1 ? (-100 * Math.log(scale)) / Math.log(step) : 0;

/** Inventory on touch: a press must rest this long before it drags (mockup: 150 ms). */
export const TOUCH_DRAG_HOLD_MS = 150;

/**
 * Touch drag decision of an inventory row: `wait` (not yet), `drag` (held ≥ TOUCH_DRAG_HOLD_MS
 * then moved ≥ `px`), `scroll` (moved before the hold: the list scrolls instead). Mouse: `drag`
 * as soon as it moved ≥ `px`.
 */
export function dragDecision(
  touch: boolean,
  heldMs: number,
  movedPx: number,
  px: number,
): 'wait' | 'drag' | 'scroll' {
  if (movedPx < px) return 'wait';
  if (!touch) return 'drag';
  return heldMs >= TOUCH_DRAG_HOLD_MS ? 'drag' : 'scroll';
}
