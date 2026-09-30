import { WebGLRenderer } from 'three';
import { createIsometricCamera, resizeIsometricCamera } from './camera/isometric.js';
import { CameraRig } from './camera/rig.js';
import { bindCameraInput } from './input/camera-input.js';
import { createScene } from './scene.js';

const VIEW_HEIGHT = 24;

const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = createScene();
const camera = createIsometricCamera({ aspect: 1, viewHeight: VIEW_HEIGHT });
const rig = new CameraRig(camera);
bindCameraInput(rig, renderer.domElement);

function resize(): void {
  const width = container?.clientWidth ?? window.innerWidth;
  const height = container?.clientHeight ?? window.innerHeight;
  renderer.setSize(width, height);
  resizeIsometricCamera(camera, width / Math.max(height, 1), VIEW_HEIGHT);
}

new ResizeObserver(resize).observe(container);
resize();

let afterRender: ((r: WebGLRenderer) => void) | undefined;
if (import.meta.env.DEV) {
  void import('./dev/stats-overlay.js').then(({ createStatsOverlay }) => {
    afterRender = createStatsOverlay(document.body);
  });
}

renderer.setAnimationLoop((time) => {
  rig.update(time);
  renderer.render(scene, camera);
  afterRender?.(renderer);
});
