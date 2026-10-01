import { describe, expect, it } from 'vitest';
import type { CameraRig } from '../camera/rig.js';
import { rebind, DEFAULT_BINDINGS } from './bindings.js';
import { bindCameraInput } from './camera-input.js';
import { InputMap } from './input-map.js';

function ev(type: string, props: Record<string, unknown>): Event {
  const e = new Event(type, { cancelable: true });
  for (const [k, value] of Object.entries(props)) Object.defineProperty(e, k, { value });
  return e;
}

describe('bindCameraInput', () => {
  it('maps rotate and zoom actions to the rig (wheel delta or a step for keys)', () => {
    const calls: string[] = [];
    const rig = {
      rotate: (d: number) => calls.push(`rotate ${d}`),
      zoomByWheel: (d: number) => calls.push(`zoom ${d}`),
      zoomStep: (d: number) => calls.push(`step ${d}`),
    } as unknown as CameraRig;
    const win = new EventTarget();
    const element = new EventTarget();
    const r = rebind(DEFAULT_BINDINGS, 'zoomIn', 'Equal', { slot: 1 });
    if (!r.ok) throw new Error('expected ok');
    const input = new InputMap(r.bindings, { window: win, element });
    const off = bindCameraInput(rig, input);
    win.dispatchEvent(ev('keydown', { code: 'KeyQ' }));
    win.dispatchEvent(ev('keydown', { code: 'KeyE' }));
    element.dispatchEvent(ev('wheel', { deltaY: -53 }));
    element.dispatchEvent(ev('wheel', { deltaY: 120 }));
    win.dispatchEvent(ev('keydown', { code: 'Equal' }));
    expect(calls).toEqual(['rotate -1', 'rotate 1', 'zoom -53', 'zoom 120', 'step 0.1']);
    off.dispose();
    win.dispatchEvent(ev('keyup', { code: 'KeyQ' }));
    win.dispatchEvent(ev('keydown', { code: 'KeyQ' }));
    expect(calls).toHaveLength(5);
  });

  it('skips zoom while blocked (modal open)', () => {
    const calls: number[] = [];
    const rig = { zoomByWheel: (d: number) => calls.push(d) } as unknown as CameraRig;
    const element = new EventTarget();
    const input = new InputMap(DEFAULT_BINDINGS, { window: new EventTarget(), element });
    let blocked = true;
    bindCameraInput(rig, input, () => blocked);
    element.dispatchEvent(ev('wheel', { deltaY: -100 }));
    blocked = false;
    element.dispatchEvent(ev('wheel', { deltaY: -100 }));
    expect(calls).toEqual([-100]);
  });

  it('repeats the key step every 120 ms while held', () => {
    const steps: number[] = [];
    const rig = { zoomStep: (d: number) => steps.push(d) } as unknown as CameraRig;
    const win = new EventTarget();
    const input = new InputMap(DEFAULT_BINDINGS, { window: win, element: new EventTarget() });
    const cam = bindCameraInput(rig, input);
    win.dispatchEvent(ev('keydown', { code: 'KeyZ' }));
    const t = performance.now();
    cam.update(t + 50);
    cam.update(t + 130);
    cam.update(t + 200);
    cam.update(t + 260);
    win.dispatchEvent(ev('keyup', { code: 'KeyZ' }));
    cam.update(t + 600);
    expect(steps).toEqual([-0.1, -0.1, -0.1]);
  });
});
