import { isWheel, mouseCode, wheelCode, type Action, type InputCode } from './actions.js';
import { indexBindings, type Bindings } from './bindings.js';

export interface ActionEvent {
  action: Action;
  code: InputCode;
  /** Wheel: |deltaY| (pixels); buttons and keys: 1. */
  amount: number;
}

export type ActionHandler = (e: ActionEvent) => void;

export interface InputTargets {
  /** Keyboard, blur, pointerup (so a button released outside the canvas is not stuck). */
  window: EventTarget;
  /** Mouse buttons and wheel (the canvas). */
  element: EventTarget;
  /** `visibilitychange` source (document); hidden tab releases everything. */
  document?: EventTarget & { visibilityState?: string };
}

/** Typing in a text field must not trigger game actions. */
function isTextInput(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  return (
    !!el && (el.isContentEditable === true || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
  );
}

/**
 * Action-based input: tracks held inputs (by code), exposes `isDown(action)` and fires
 * `on(action)` handlers on press (key repeats ignored) and on wheel ticks. Everything is released
 * on window blur / hidden tab, so keys never stay stuck.
 */
export class InputMap {
  private index = new Map<InputCode, Action[]>();
  private readonly held = new Set<InputCode>();
  private suspended = false;
  private readonly handlers = new Map<Action, Set<ActionHandler>>();
  private readonly releaseHandlers = new Map<Action, Set<() => void>>();
  /** Actions held by on-screen touch buttons (`holdVirtual`), next to physical codes. */
  private readonly virtualHeld = new Set<Action>();
  /** Touch mode: touch pointers are gestures (tap, stick, pinch), not mouse buttons. */
  private ignoreTouch = false;
  private readonly listeners: [
    EventTarget,
    string,
    EventListener,
    AddEventListenerOptions | undefined,
  ][] = [];

  constructor(
    bindings: Bindings,
    private readonly targets: InputTargets,
  ) {
    this.setBindings(bindings);
    const { window: win, element, document: doc } = targets;
    this.listen(win, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(win, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(win, 'blur', () => this.releaseAll());
    this.listen(element, 'pointerdown', (e) => {
      const p = e as PointerEvent;
      if (this.ignoreTouch && p.pointerType === 'touch') return;
      this.onButton(p.button, true);
    });
    this.listen(win, 'pointerup', (e) => this.onButton((e as PointerEvent).button, false));
    // Chorded buttons (LMB while RMB is held to aim) fire `pointermove` with `button` ≥ 0, not
    // `pointerdown` / `pointerup` (Pointer Events spec).
    this.listen(element, 'pointermove', (e) => {
      const p = e as PointerEvent;
      if (this.ignoreTouch && p.pointerType === 'touch') return;
      if (p.button >= 0) this.onButton(p.button, (p.buttons & buttonBit(p.button)) !== 0);
    });
    this.listen(element, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    if (doc) {
      this.listen(doc, 'visibilitychange', () => {
        if (doc.visibilityState === 'hidden') this.releaseAll();
      });
    }
  }

  setBindings(bindings: Bindings): void {
    this.index = indexBindings(bindings);
  }

  isDown(action: Action): boolean {
    if (this.virtualHeld.has(action)) return true;
    for (const code of this.held) if (this.index.get(code)?.includes(action)) return true;
    return false;
  }

  /** Press handler; returns an unsubscribe function. */
  on(action: Action, handler: ActionHandler): () => void {
    let set = this.handlers.get(action);
    if (!set) this.handlers.set(action, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  /** Release handler of an action held by `holdVirtual` (touch buttons); returns unsubscribe. */
  onRelease(action: Action, handler: () => void): () => void {
    let set = this.releaseHandlers.get(action);
    if (!set) this.releaseHandlers.set(action, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  /**
   * Holds / releases an action from an on-screen (touch) button, as if its key were held: the
   * press fires `on(action)` handlers once and `isDown` is true until the release, which fires
   * `onRelease` handlers. Ignored while suspended (releases still go through).
   */
  holdVirtual(action: Action, down: boolean): void {
    if (!down) {
      if (this.virtualHeld.delete(action)) {
        for (const h of this.releaseHandlers.get(action) ?? []) h();
      }
      return;
    }
    if (this.suspended || this.virtualHeld.has(action)) return;
    this.virtualHeld.add(action);
    for (const h of this.handlers.get(action) ?? []) h({ action, code: 'Touch', amount: 1 });
  }

  /** Touch mode: touch pointers no longer count as mouse buttons (see `TouchControls`). */
  setIgnoreTouchPointers(ignore: boolean): void {
    this.ignoreTouch = ignore;
  }

  /**
   * Suspends game input (pause menu, modal screens): presses are ignored and everything held is
   * released; releases still clear held inputs.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.releaseAll();
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  releaseAll(): void {
    this.held.clear();
    for (const a of [...this.virtualHeld]) this.holdVirtual(a, false);
  }

  dispose(): void {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
    this.handlers.clear();
    this.releaseHandlers.clear();
    this.held.clear();
    this.virtualHeld.clear();
  }

  private listen(t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    t.addEventListener(type, fn, opts);
    this.listeners.push([t, type, fn, opts]);
  }

  private press(code: InputCode, amount: number): void {
    if (this.suspended) return;
    for (const action of this.index.get(code) ?? []) {
      for (const h of this.handlers.get(action) ?? []) h({ action, code, amount });
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!e.code) return;
    if (!down) {
      this.held.delete(e.code);
      return;
    }
    if (isTextInput(e.target) || this.suspended) return;
    const wasHeld = this.held.has(e.code);
    this.held.add(e.code);
    if (!e.repeat && !wasHeld) this.press(e.code, 1);
  }

  private onButton(button: number, down: boolean): void {
    const code = mouseCode(button);
    if (!down) {
      this.held.delete(code);
      return;
    }
    if (this.held.has(code) || this.suspended) return;
    this.held.add(code);
    this.press(code, 1);
  }

  private onWheel(e: WheelEvent): void {
    if (e.deltaY === 0) return;
    const code = wheelCode(e.deltaY);
    // The wheel only zooms the game view; keep the page from scrolling (previous behaviour).
    e.preventDefault();
    if (isWheel(code)) this.press(code, Math.abs(e.deltaY));
  }
}

/** `PointerEvent.button` → its bit in `PointerEvent.buttons` (left 1, right 2, middle 4, …). */
const buttonBit = (button: number): number => (button === 1 ? 4 : button === 2 ? 2 : 1 << button);
