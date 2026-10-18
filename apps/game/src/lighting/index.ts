import type { OrthographicCamera, Scene, WebGLRenderer } from 'three';
import type { CompiledPreset } from './compiled.js';
import { NIGHT_PRESET, type LightingPreset } from './preset.js';
import { SceneLighting, configureRenderer } from './scene-lighting.js';
import { StreetLamps, type LampDef, type StreetLampsOptions } from './street-lamps.js';

export { NIGHT_PRESET, blendPresets, lerpPreset, type LightingPreset } from './preset.js';
export { placeholderMaterial } from './materials.js';
export type { LampDef } from './street-lamps.js';
export { DayCycle } from './day-cycle.js';
export { DAY_CYCLE } from './day-cycle-config.js';
export { SUN_LIGHT, applySun, sunForClock } from './sun-light.js';
export { clockMinute, formatMinute, overrideMinute, parseTimeParam } from './game-clock.js';

export interface WorldLighting {
  readonly sky: SceneLighting;
  readonly lamps: StreetLamps;
  /** Switch or blend the look (e.g. `blendPresets(NIGHT, DAY, t)` later). */
  apply(preset: LightingPreset): void;
  /** Allocation-free per-frame look (day cycle): blended preset + lamp level 0..1. */
  applyCompiled(preset: CompiledPreset, lampLevel: number): void;
  /** Per frame, after the camera rig update. `focus` = camera target (world X, Z). */
  update(camera: OrthographicCamera, focusX: number, focusZ: number): void;
}

/** Sets up the renderer, global lights, fog and street lamps. Night is the default look. */
export function createWorldLighting(
  scene: Scene,
  renderer: WebGLRenderer,
  lamps: readonly LampDef[],
  cameraDistance: number,
  preset: LightingPreset = NIGHT_PRESET,
  lampOptions?: StreetLampsOptions,
): WorldLighting {
  configureRenderer(renderer, preset);
  const sky = new SceneLighting(scene, preset, cameraDistance);
  const street = new StreetLamps(lamps, lampOptions);
  street.apply(preset.lamps);
  scene.add(street.root);
  return {
    sky,
    lamps: street,
    apply(p) {
      sky.apply(p, renderer);
      street.apply(p.lamps);
    },
    applyCompiled(c, level) {
      sky.applyCompiled(c, renderer);
      street.applyCompiled(c.lamps);
      street.setLevel(level);
    },
    update(camera, fx, fz) {
      sky.update(camera);
      street.update(fx, fz);
    },
  };
}
