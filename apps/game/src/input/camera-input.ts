import type { CameraRig } from '../camera/rig.js';
import type { InputMap } from './input-map.js';

/** Default wheel notch; used as the zoom step when zoom is bound to a key or button. */
const STEP_DELTA = 100;

/** Wires rotateCamera* and zoom* actions to the rig. Returns a dispose function. */
export function bindCameraInput(rig: CameraRig, input: InputMap): () => void {
  const zoom = (sign: 1 | -1) => (e: { code: string; amount: number }) =>
    rig.zoomByWheel(sign * (e.code.startsWith('Wheel') ? e.amount : STEP_DELTA));
  const offs = [
    input.on('rotateCameraLeft', () => rig.rotate(-1, performance.now())),
    input.on('rotateCameraRight', () => rig.rotate(1, performance.now())),
    input.on('zoomIn', zoom(-1)),
    input.on('zoomOut', zoom(1)),
  ];
  return () => offs.forEach((off) => off());
}
