// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BINDINGS } from '../../input/bindings.js';
import { InputMap } from '../../input/input-map.js';
import { TouchControls } from '../../input/touch/touch-controls.js';
import { createTouchHud } from './touch-hud.js';

function finger(type: string, pointerId: number, x = 0, y = 0): PointerEvent {
  return new PointerEvent(type, {
    pointerId,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
}

function setup() {
  const root = document.createElement('div');
  document.body.append(root);
  const canvas = document.createElement('canvas');
  root.append(canvas);
  const input = new InputMap(DEFAULT_BINDINGS, { window: new EventTarget(), element: canvas });
  const aim = vi.fn();
  const controls = new TouchControls({
    input,
    element: canvas,
    tap: () => false,
    longPress: () => false,
    aim,
    zoom: () => {},
    zoomStep: 1,
  });
  const hud = createTouchHud(root, controls);
  const btn = (id: string) => hud.el.querySelector<HTMLElement>(`[data-touch-btn="${id}"]`)!;
  return {
    input,
    controls,
    aim,
    hud,
    btn,
    move: hud.el.querySelector<HTMLElement>('.dz-touch__move')!,
    aimZone: hud.el.querySelector<HTMLElement>('.dz-touch__aim')!,
  };
}

describe('touch HUD: multitouch', () => {
  it('stick, aim drag, sprint and attack all at once, each finger on its own control', () => {
    const t = setup();
    const attacks = vi.fn();
    t.input.on('primaryAction', attacks);
    t.move.dispatchEvent(finger('pointerdown', 1, 100, 300));
    t.move.dispatchEvent(finger('pointermove', 1, 100, 250));
    t.aimZone.dispatchEvent(finger('pointerdown', 2, 700, 100));
    t.btn('sprint').dispatchEvent(finger('pointerdown', 3));
    t.btn('attack').dispatchEvent(finger('pointerdown', 4));
    expect(t.controls.stick.active).toBe(true);
    expect(t.controls.vector()).not.toEqual({ x: 0, y: 0, magnitude: 0 });
    expect(t.aim).toHaveBeenCalledTimes(1);
    expect(t.aim.mock.calls[0]![0]).toBeDefined();
    expect(t.input.isDown('sprint')).toBe(true);
    expect(t.input.isDown('primaryAction')).toBe(true);
    expect(attacks).toHaveBeenCalledTimes(1);
    // Lifting the attack finger keeps running and moving.
    t.btn('attack').dispatchEvent(finger('pointerup', 4));
    expect(t.input.isDown('primaryAction')).toBe(false);
    expect(t.input.isDown('sprint')).toBe(true);
    expect(t.controls.stick.active).toBe(true);
    // A quick slot tap (hand switch) with three fingers down.
    const slot = vi.fn();
    t.input.on('quickslot1', slot);
    t.controls.tap('slot1');
    expect(slot).toHaveBeenCalledTimes(1);
    t.move.dispatchEvent(finger('pointerup', 1));
    expect(t.controls.stick.active).toBe(false);
    expect(t.input.isDown('sprint')).toBe(true);
    t.btn('sprint').dispatchEvent(finger('pointerup', 3));
    expect(t.input.isDown('sprint')).toBe(false);
    t.hud.dispose();
  });

  it('a held button stays down until its last finger lifts', () => {
    const t = setup();
    t.btn('sprint').dispatchEvent(finger('pointerdown', 5));
    t.btn('sprint').dispatchEvent(finger('pointerdown', 6));
    t.btn('sprint').dispatchEvent(finger('pointerup', 6));
    expect(t.input.isDown('sprint')).toBe(true);
    t.btn('sprint').dispatchEvent(finger('pointerup', 5));
    expect(t.input.isDown('sprint')).toBe(false);
    t.hud.dispose();
  });

  it('quick slots 1–5 are all tappable on the phone hotbar', () => {
    const t = setup();
    const bar = document.createElement('div');
    bar.className = 'dz-hotbar';
    for (let i = 0; i < 5; i++) bar.append(document.createElement('div'));
    t.hud.el.parentElement!.append(bar);
    const hits: number[] = [];
    for (let i = 1; i <= 5; i++) t.input.on(`quickslot${i}` as 'quickslot1', () => hits.push(i));
    for (const s of bar.children) s.dispatchEvent(finger('pointerdown', 9));
    expect(hits).toEqual([1, 2, 3, 4, 5]);
    t.hud.dispose();
  });
});
