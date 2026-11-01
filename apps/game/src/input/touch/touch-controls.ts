import type { Action } from '../actions.js';
import type { InputMap } from '../input-map.js';
import { LONG_PRESS_MS, TouchGestures, pinchToWheel } from './gestures.js';
import { IDLE_STICK, VirtualStick, type StickVector } from './virtual-stick.js';

/** Buttons of the touch UI (mockup: Atak, Akcja, Bieg, Skradanie, Cel, top bar). */
export const TOUCH_ACTIONS = [
  'attack',
  'interact',
  'sneak',
  'use',
  'sprint',
  'target',
  'inventory',
  'map',
  'pause',
  'slot1',
  'slot2',
  'slot3',
  'reload',
] as const;
export type TouchAction = (typeof TOUCH_ACTIONS)[number];

/**
 * Touch button → existing input action (same handlers as the keys / mouse): atak = LMB
 * (`primaryAction`), F = `interact` (held = search, like the key), skradanie = `crouch` (C, the
 * sneak toggle), użyj = RMB short click (`secondaryAction`: car menu, furniture menu, shove),
 * bieg = held Shift (`sprint`), cel = Tab (`targetNext`), top bar = the screen keys and 1–3.
 */
export const TOUCH_ACTION_MAP: Readonly<Record<TouchAction, Action>> = {
  attack: 'primaryAction',
  interact: 'interact',
  sneak: 'crouch',
  use: 'secondaryAction',
  sprint: 'sprint',
  target: 'targetNext',
  inventory: 'inventory',
  map: 'map',
  pause: 'pause',
  slot1: 'quickslot1',
  slot2: 'quickslot2',
  slot3: 'quickslot3',
  reload: 'reload',
};

export interface TouchControlsOptions {
  input: InputMap;
  /** Touch surface (the game canvas): taps, pinch and the dev stick. */
  element: HTMLElement;
  /** Tap on the world (CSS px in `element`): the object's default action; false = nothing there. */
  tap: (x: number, y: number) => boolean;
  /** Long press on the world: the object's context menu (what RMB does); false = nothing. */
  longPress: (x: number, y: number) => boolean;
  /** Aim / turn at a screen point (right-top drag zone); `undefined` = drag ended (auto aim). */
  aim?: (p: { x: number; y: number } | undefined) => void;
  /** Atak without an aim drag: turn to the nearest zombie in front first (auto aim). */
  autoAim?: () => void;
  /** Pinch as a wheel delta (`rig.zoomByWheel`). */
  zoom: (wheelDeltaY: number) => void;
  /** Zoom limits step (`ZoomLimits.step`). */
  zoomStep: number;
  /** Dev `?touchDebug=1`: a drag starting on the left half is an invisible floating stick. */
  debug?: boolean;
  /** Game input blocked (window open, pause): no taps / stick. */
  blocked?: () => boolean;
}

/**
 * Touch input layer (no visible UI): gestures on the canvas and the API the touch HUD will call
 * (`stick`, `press` / `release` / `tap`). Movement goes through `PlayerInput.setStick`.
 */
export class TouchControls {
  /** The joystick: the UI feeds `start` / `move` / `end` with its finger (or `setStick`). */
  readonly stick = new VirtualStick();
  private external: StickVector | undefined;
  private readonly gestures: TouchGestures;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly opts: TouchControlsOptions) {
    opts.input.setIgnoreTouchPointers(true);
    this.gestures = new TouchGestures((e) => {
      if (this.blocked()) return;
      if (e.type === 'pinch') opts.zoom(pinchToWheel(e.scale, opts.zoomStep));
      else if (e.type === 'longPress') opts.longPress(e.x, e.y);
      else opts.tap(e.x, e.y);
    });
    const el = opts.element;
    // Pointer events only (no browser pan / pinch-zoom of the page over the canvas).
    el.style.touchAction = 'none';
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const on = (type: string, fn: (e: PointerEvent) => void) => {
      const h = (e: Event) => {
        const p = e as PointerEvent;
        if (p.pointerType === 'touch') fn(p);
      };
      el.addEventListener(type, h);
      this.offs.push(() => el.removeEventListener(type, h));
    };
    on('pointerdown', (e) => {
      const { x, y } = local(e);
      if (opts.debug && !this.stick.active && this.gestures.count === 0 && x < el.clientWidth / 2)
        this.stick.start(e.pointerId, x, y);
      else {
        this.gestures.down(e.pointerId, x, y, e.timeStamp);
        this.armLongPress();
      }
    });
    on('pointermove', (e) => {
      const { x, y } = local(e);
      this.stick.move(e.pointerId, x, y);
      this.gestures.move(e.pointerId, x, y);
    });
    on('pointerup', (e) => {
      this.stick.end(e.pointerId);
      this.gestures.up(e.pointerId, e.timeStamp);
    });
    on('pointercancel', (e) => {
      this.stick.end(e.pointerId);
      this.gestures.cancel(e.pointerId);
    });
  }

  /** Pointer events on the HUD layers (move zone, aim zone) are fed here too. */
  private longTimer: ReturnType<typeof setTimeout> | undefined;
  private armLongPress(): void {
    if (this.longTimer !== undefined) clearTimeout(this.longTimer);
    this.longTimer = setTimeout(() => {
      this.longTimer = undefined;
      this.gestures.poll(performance.now());
    }, LONG_PRESS_MS + 10);
  }

  /** Aim at a screen point (the aim zone drag) or back to auto aim (`undefined`). */
  aim(p: { x: number; y: number } | undefined): void {
    this.aiming = p !== undefined;
    this.opts.aim?.(p);
  }

  private aiming = false;

  /** Current stick vector (`PlayerInput.setStick`): the UI's own one, else the floating stick. */
  vector(): StickVector {
    if (this.blocked()) return IDLE_STICK;
    return this.external ?? this.stick.vector;
  }

  /** A UI stick that computes its own vector (`stickVector`); `undefined` hands back control. */
  setStick(v: StickVector | undefined): void {
    this.external = v;
  }

  /** Button down: the mapped action is held (`InputMap.holdVirtual`). */
  press(a: TouchAction): void {
    if (a === 'attack' && !this.aiming) this.opts.autoAim?.();
    this.opts.input.holdVirtual(TOUCH_ACTION_MAP[a], true);
  }

  /** Button up. */
  release(a: TouchAction): void {
    this.opts.input.holdVirtual(TOUCH_ACTION_MAP[a], false);
  }

  /** Short press (down + up). */
  tap(a: TouchAction): void {
    this.press(a);
    this.release(a);
  }

  dispose(): void {
    if (this.longTimer !== undefined) clearTimeout(this.longTimer);
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.stick.end();
    for (const a of TOUCH_ACTIONS) this.release(a);
    this.opts.input.setIgnoreTouchPointers(false);
  }

  private blocked(): boolean {
    return this.opts.blocked?.() ?? false;
  }
}
