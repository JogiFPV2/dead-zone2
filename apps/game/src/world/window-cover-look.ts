import type { WindowCoverView } from '@deadzone/protocol';
import type { Matrix4} from 'three';
import { Color, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { LEVEL_HEIGHT } from './instances.js';
import { WALL_HEIGHT, WINDOW_HEIGHT } from './structure-instances.js';

/**
 * Covered windows (bld-spec §4–5, `bld-window-states.png`): a cloth panel in the frame, one
 * InstancedMesh per openings view with a shared material (per-instance colour, opacity and
 * glow), hidden when no window is covered, so no draw call per window.
 *
 * - curtain: full dark-red fabric; light 15 %;
 * - jacket / hoodie (clothing): hangs over ~78 % of the glass from the top, gap at the sill;
 * - sheet / blanket: full uneven sheet in the item colour;
 * - tarp: full, opaque blue-grey.
 * `blocksSight` → opaque, so the interior card behind the glass is hidden; without it the panel is
 * see-through by `lightPass`. A lit room behind it glows through by `lightPass` (`lit`).
 */
export type CoverStyle = 'curtain' | 'clothing' | 'sheet' | 'tarp';

export interface CoverLook {
  style: CoverStyle;
  /** sRGB hex. */
  color: number;
  /** 0–1: 1 = opaque. */
  alpha: number;
  /** Share of the glass height covered from the top (1 = all). */
  coverage: number;
  /** Warm light let through when the room behind is lit (0–1). */
  glow: number;
}

const STYLE: Readonly<Record<string, { style: CoverStyle; color: number }>> = {
  'base:curtain': { style: 'curtain', color: 0x8e3a44 },
  'base:jacket': { style: 'clothing', color: 0x4f5a35 },
  'base:hoodie': { style: 'clothing', color: 0x5a6470 },
  'base:sheet': { style: 'sheet', color: 0xd9d6e8 },
  'base:blanket': { style: 'sheet', color: 0x9c8466 },
  'base:tarp': { style: 'tarp', color: 0x3f6a86 },
};

/** Share of the glass a hung piece of clothing covers (spec: ~78 %, a gap at the sill). */
export const CLOTHING_COVERAGE = 0.78;
/** See-through panels (`blocksSight: false`) are never fainter than this. */
const MIN_ALPHA = 0.3;

export function coverLook(c: WindowCoverView): CoverLook {
  const known = STYLE[c.item];
  // Unknown items: light ones (≥ 0.3 light) read as clothing, the rest as a sheet.
  const style = known?.style ?? (c.lightPass >= 0.3 ? 'clothing' : 'sheet');
  const color = known?.color ?? (style === 'clothing' ? 0x56604a : 0xbdb6a4);
  const pass = Math.max(0, Math.min(1, c.lightPass));
  return {
    style,
    color,
    alpha: c.blocksSight ? 1 : Math.max(MIN_ALPHA, 1 - pass),
    coverage: style === 'clothing' ? CLOTHING_COVERAGE : 1,
    glow: pass,
  };
}

/** Glass band of a window (m above the floor), like the pane in `openings.ts`. */
const BAND = { bottom: WINDOW_HEIGHT, top: WALL_HEIGHT - 0.25 };
/** Panel slightly thicker than the pane (0.04 m): it shows from both sides over the glass. */
const THICKNESS = 0.07;
const WIDTH = 0.9;

/** Edge of a window (sim address). */
export interface CoverEdge {
  tx: number;
  ty: number;
  z: number;
  side: 'n' | 'w';
}

/** Pose of the cover panel (unit box); zero scale when `show` is false. Pure (tests). */
export function coverMatrix(out: Matrix4, e: CoverEdge, coverage: number, show: boolean): Matrix4 {
  if (!show || coverage <= 0) return out.makeScale(0, 0, 0);
  const h = (BAND.top - BAND.bottom) * Math.min(1, coverage);
  const along = e.side === 'n' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
  const q = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    e.side === 'n' ? 0 : -Math.PI / 2,
  );
  const pos = new Vector3(e.tx, e.z * LEVEL_HEIGHT + BAND.top - h / 2, e.ty).addScaledVector(
    along,
    0.5,
  );
  return out.compose(pos, q, new Vector3(WIDTH, h, THICKNESS));
}

/** Warm room light seen through a cover (linear RGB, × glow). */
const GLOW = new Color(1, 0.72, 0.42).multiplyScalar(1.6);

let shared: MeshStandardMaterial | undefined;

/**
 * Shared cover material: instance colour + per-instance `coverFx` (x: opacity, y: glow). One
 * program for every openings view.
 */
export function coverMaterial(): MeshStandardMaterial {
  if (shared) return shared;
  const m = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    transparent: true,
    flatShading: true,
  });
  m.name = 'window-cover';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.coverGlow = { value: GLOW };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 coverFx;\nvarying vec2 vCoverFx;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoverFx = coverFx;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vCoverFx;\nuniform vec3 coverGlow;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += coverGlow * vCoverFx.y;',
      )
      .replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\ngl_FragColor.a *= vCoverFx.x;',
      );
  };
  m.customProgramCacheKey = () => 'window-cover-1';
  shared = m;
  return m;
}
