import type { CameraRig } from '../camera/rig.js';
import type { InputMap } from './input-map.js';

/** Zoom step of a key / button press (HUD v2 camera chip: 0.1). */
export const KEY_ZOOM_STEP = 0.1;
/** While a zoom key is held the step repeats this often (ms). */
export const KEY_ZOOM_REPEAT_MS = 120;

export interface CameraInput {
  /** Per frame: repeats the key zoom step while Z / X is held. */
  update(nowMs: number): void;
  dispose(): void;
}

/**
 * Wires rotateCamera* and zoom* actions to the rig. The wheel is read on the canvas only, so
 * it never zooms over HUD panels or windows (DOM above the canvas); keys step the zoom by 0.1
 * and repeat every 120 ms while held. `zoomBlocked` skips zoom while a modal screen is up.
 */
export function bindCameraInput(
  rig: CameraRig,
  input: InputMap,
  zoomBlocked: () => boolean = () => false,
): CameraInput {
  let lastStep = 0;
  const zoom = (sign: 1 | -1) => (e: { code: string; amount: number }) => {
    if (zoomBlocked()) return;
    if (e.code.startsWith('Wheel')) rig.zoomByWheel(sign * e.amount);
    else {
      rig.zoomStep(-sign * KEY_ZOOM_STEP);
      lastStep = performance.now();
    }
  };
  const offs = [
    input.on('rotateCameraLeft', () => rig.rotate(-1, performance.now())),
    input.on('rotateCameraRight', () => rig.rotate(1, performance.now())),
    input.on('zoomIn', zoom(-1)),
    input.on('zoomOut', zoom(1)),
  ];
  return {
    update(nowMs) {
      const dir = (input.isDown('zoomIn') ? 1 : 0) - (input.isDown('zoomOut') ? 1 : 0);
      if (dir === 0 || zoomBlocked() || nowMs - lastStep < KEY_ZOOM_REPEAT_MS) return;
      lastStep = nowMs;
      rig.zoomStep(dir * KEY_ZOOM_STEP);
    },
    dispose: () => offs.forEach((off) => off()),
  };
}
