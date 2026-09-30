import { WebGLRenderer } from 'three';
import { createIsometricCamera, resizeIsometricCamera } from './camera/isometric.js';
import { createScene } from './scene.js';

const VIEW_HEIGHT = 24;

const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = createScene();
const camera = createIsometricCamera({ aspect: 1, viewHeight: VIEW_HEIGHT });

function resize(): void {
  const width = container?.clientWidth ?? window.innerWidth;
  const height = container?.clientHeight ?? window.innerHeight;
  renderer.setSize(width, height);
  resizeIsometricCamera(camera, width / Math.max(height, 1), VIEW_HEIGHT);
}

new ResizeObserver(resize).observe(container);
resize();

renderer.setAnimationLoop(() => renderer.render(scene, camera));
