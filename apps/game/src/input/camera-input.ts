import type { CameraRig } from '../camera/rig.js';

/** Wires mouse wheel (zoom) and Q/E (rotate) to the rig. Returns a dispose function. */
export function bindCameraInput(rig: CameraRig, wheelTarget: HTMLElement): () => void {
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    rig.zoomByWheel(e.deltaY);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'KeyQ') rig.rotate(-1, performance.now());
    else if (e.code === 'KeyE') rig.rotate(1, performance.now());
  };
  wheelTarget.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  return () => {
    wheelTarget.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKey);
  };
}
