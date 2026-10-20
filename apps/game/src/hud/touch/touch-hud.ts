import './touch.css';
import { chromeIcon, type ChromeIcon } from '../v2/icons.js';
import type { TouchAction, TouchControls } from '../../input/touch/touch-controls.js';
import { STICK_KNOB_PX, STICK_RADIUS_PX } from '../../input/touch/virtual-stick.js';

/** Buttons of the right thumb (mockup m.html: size and offsets from the safe-area corner). */
export const TOUCH_BUTTONS: readonly {
  id: TouchAction;
  label: string;
  icon: ChromeIcon;
  size: number;
  right: number;
  bottom: number;
  /** Held while pressed (Bieg), a switch with a state (Skradanie), or a press (the rest). */
  kind: 'hold' | 'toggle' | 'press';
}[] = [
  { id: 'attack', label: 'ATAK', icon: 'swords', size: 84, right: 22, bottom: 18, kind: 'hold' },
  { id: 'interact', label: 'AKCJA', icon: 'hand', size: 56, right: 118, bottom: 22, kind: 'hold' },
  { id: 'sprint', label: 'BIEG', icon: 'run', size: 56, right: 104, bottom: 90, kind: 'hold' },
  { id: 'sneak', label: 'SKRAD', icon: 'sneak', size: 56, right: 38, bottom: 116, kind: 'toggle' },
  { id: 'target', label: 'CEL', icon: 'target', size: 44, right: 180, bottom: 80, kind: 'press' },
];

/** Top bar buttons right of the quick slots (Ekwipunek, Mapa, Pauza). */
export const TOUCH_TOP: readonly { id: TouchAction; label: string; icon: ChromeIcon }[] = [
  { id: 'inventory', label: 'Ekwipunek', icon: 'bag' },
  { id: 'map', label: 'Mapa', icon: 'pin' },
  { id: 'pause', label: 'Pauza', icon: 'pause' },
];

export interface TouchHud {
  readonly el: HTMLElement;
  /** Per frame: stick drawing, the sneak switch state. */
  update(state: { sneaking: boolean }): void;
  dispose(): void;
}

/**
 * Touch controls layer (`html.is-touch` only, mockup mobile-controls.png): floating joystick in
 * the left 44 %, right-top drag zone (turn / aim), thumb buttons, a top bar (quick slots 1–3 go
 * to the HUD hotbar, moved up by touch.css) and the „obróć telefon” board in portrait. Feeds
 * `TouchControls`; draws nothing on desktop (the layer is not created there).
 */
export function createTouchHud(root: HTMLElement, controls: TouchControls): TouchHud {
  const el = document.createElement('div');
  el.className = 'dz-touch';
  const offs: (() => void)[] = [];
  const listen = (t: EventTarget, type: string, fn: (e: PointerEvent) => void) => {
    const h = (e: Event) => fn(e as PointerEvent);
    t.addEventListener(type, h);
    offs.push(() => t.removeEventListener(type, h));
  };
  /** Capture keeps a finger's moves on its control; a lost / synthetic pointer is fine without. */
  const capture = (t: Element, id: number) => {
    try {
      t.setPointerCapture(id);
    } catch {
      /* no active pointer */
    }
  };
  const local = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // ── Joystick zone (left 44 %, bottom 62 %): the stick appears where the thumb lands.
  const moveZone = document.createElement('div');
  moveZone.className = 'dz-touch__move';
  const ring = document.createElement('div');
  ring.className = 'dz-touch__stick';
  ring.style.width = ring.style.height = `${STICK_RADIUS_PX * 2}px`;
  const knob = document.createElement('i');
  knob.style.width = knob.style.height = `${STICK_KNOB_PX}px`;
  ring.append(knob);
  // The ring hangs on the whole layer (stick coordinates are root-local).
  listen(moveZone, 'pointerdown', (e) => {
    if (controls.stick.active) return;
    capture(moveZone, e.pointerId);
    const p = local(e);
    controls.stick.start(e.pointerId, p.x, p.y);
  });
  listen(moveZone, 'pointermove', (e) => {
    const p = local(e);
    controls.stick.move(e.pointerId, p.x, p.y);
  });
  for (const t of ['pointerup', 'pointercancel'])
    listen(moveZone, t, (e) => controls.stick.end(e.pointerId));

  // ── Right-top zone: drag = turn / aim at the finger; lift = auto aim.
  const aimZone = document.createElement('div');
  aimZone.className = 'dz-touch__aim';
  let aimId: number | undefined;
  listen(aimZone, 'pointerdown', (e) => {
    if (aimId !== undefined) return;
    aimId = e.pointerId;
    capture(aimZone, e.pointerId);
    controls.aim(local(e));
  });
  listen(aimZone, 'pointermove', (e) => {
    if (e.pointerId === aimId) controls.aim(local(e));
  });
  for (const t of ['pointerup', 'pointercancel'])
    listen(aimZone, t, (e) => {
      if (e.pointerId !== aimId) return;
      aimId = undefined;
      controls.aim(undefined);
    });

  // ── Thumb buttons.
  const buttons = new Map<TouchAction, HTMLButtonElement>();
  const button = (id: TouchAction, cls: string, icon: ChromeIcon, label: string, size: number) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.dataset.touchBtn = id;
    b.setAttribute('aria-label', label);
    b.append(chromeIcon(icon, Math.round(size * 0.36), 'dz-ci'));
    return b;
  };
  for (const d of TOUCH_BUTTONS) {
    const b = button(d.id, 'dz-touch__btn', d.icon, d.label, d.size);
    const cap = document.createElement('span');
    cap.textContent = d.label;
    b.append(cap);
    Object.assign(b.style, {
      width: `${d.size}px`,
      height: `${d.size}px`,
      right: `calc(${d.right}px + var(--dz-safe-r))`,
      bottom: `calc(${d.bottom}px + var(--dz-safe-b))`,
    });
    if (d.id === 'attack') b.classList.add('dz-touch__btn--attack');
    bindPress(b, d.kind, d.id);
    buttons.set(d.id, b);
    el.append(b);
  }

  // ── Top bar: Ekwipunek, Mapa, Pauza (HP, moodles and slots 1–3 are the HUD's own, moved).
  const top = document.createElement('div');
  top.className = 'dz-touch__top';
  for (const d of TOUCH_TOP) {
    const b = button(d.id, 'dz-touch__pill', d.icon, d.label, 44);
    bindPress(b, 'press', d.id);
    top.append(b);
  }
  // Quick slots 1–3: the HUD hotbar (moved into the top bar by touch.css) answers taps.
  listen(root, 'pointerdown', (e) => {
    const slot = (e.target as HTMLElement | null)?.closest?.('.dz-hotbar > *');
    if (!slot?.parentElement) return;
    const i = [...slot.parentElement.children].indexOf(slot);
    if (i >= 0 && i < 3) controls.tap(`slot${i + 1}` as TouchAction);
  });

  // ── Portrait: „obróć telefon” board (shown by CSS in portrait only).
  const rotate = document.createElement('div');
  rotate.className = 'dz-touch__rotate';
  rotate.append(chromeIcon('rotate', 56, 'dz-ci'));
  const msg = document.createElement('p');
  msg.textContent = 'Obróć telefon';
  const sub = document.createElement('small');
  sub.textContent = 'Deadzone gra się poziomo';
  rotate.append(msg, sub);

  // Close pill of windows (Ekwipunek, mapa …): Esc on a phone (the `pause` action closes the
  // topmost window first). Board and pill sit above every HUD layer.
  const close = button('pause', 'dz-touch__pill dz-touch__close', 'close', 'Zamknij', 44);
  const closeCap = document.createElement('span');
  closeCap.textContent = 'ZAMKNIJ';
  close.append(closeCap);
  close.hidden = true;
  bindPress(close, 'press', 'pause');
  const above = document.createElement('div');
  above.className = 'dz-touch-top';
  above.append(close, rotate);
  el.append(moveZone, aimZone, ring, top);
  root.append(el);
  document.body.append(above);

  function bindPress(b: HTMLElement, kind: 'hold' | 'toggle' | 'press', id: TouchAction): void {
    listen(b, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      capture(b, e.pointerId);
      b.dataset.down = 'true';
      if (kind === 'hold') controls.press(id);
      else controls.tap(id);
    });
    const up = () => {
      if (!b.dataset.down) return;
      delete b.dataset.down;
      if (kind === 'hold') controls.release(id);
    };
    listen(b, 'pointerup', up);
    listen(b, 'pointercancel', up);
  }

  return {
    el,
    update({ sneaking }) {
      const k = controls.stick.knob;
      ring.dataset.active = String(controls.stick.active);
      if (controls.stick.active) {
        ring.style.left = `${k.cx - STICK_RADIUS_PX}px`;
        ring.style.top = `${k.cy - STICK_RADIUS_PX}px`;
      } else {
        ring.style.left = ring.style.top = '';
      }
      knob.style.transform = `translate(${k.dx}px, ${k.dy}px)`;
      buttons.get('sneak')?.toggleAttribute('data-on', sneaking);
      close.hidden = !root.dataset.modal;
    },
    dispose() {
      for (const off of offs) off();
      el.remove();
      above.remove();
    },
  };
}
