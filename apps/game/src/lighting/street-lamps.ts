import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SpotLight,
  Vector3,
  type BufferGeometry,
  type MeshStandardMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEFAULT_LIGHT_BUDGET, selectLamps, type LightBudget } from './light-budget.js';
import { placeholderMaterial } from './materials.js';
import { compilePreset, type CompiledPreset } from './compiled.js';
import { LIGHTING_CONFIG, NIGHT_PRESET, type LightingPreset } from './preset.js';

/** A street lamp object: pole at (x, z), arm pointing along (armX, armZ) (unit, floor plane). */
export interface LampDef {
  readonly x: number;
  readonly z: number;
  readonly armX: number;
  readonly armZ: number;
  /** Broken lamps: dark head, no light, no glow. */
  readonly working: boolean;
}

/** Grey-box lamp sizes (world units), from the reference scene. */
export const LAMP_POLE_HEIGHT = 4.4;
export const LAMP_ARM_LENGTH = 0.8;
const GLOW_SIZE = 9;
const GLOW_Y = 0.03;
const LAMP_GREY = '#3e4240';

/** World floor position of the lamp head (where the light hangs). */
export function lampHead(l: LampDef): { x: number; z: number } {
  return { x: l.x + l.armX * LAMP_ARM_LENGTH, z: l.z + l.armZ * LAMP_ARM_LENGTH };
}

/** Y rotation that turns local +X (the arm) towards (armX, armZ). */
export const lampRotationY = (l: LampDef): number => Math.atan2(-l.armZ, l.armX);

export interface StreetLampsOptions {
  budget?: LightBudget;
  /** How many of the budgeted lights (nearest first) cast shadows. */
  shadowedLights?: number;
}

/**
 * All lamps of the map in three InstancedMeshes (body, lit bulbs, glow decals): 3 draw calls
 * regardless of the lamp count. Real SpotLights come from a fixed pool (no shader recompiles)
 * and are given to the nearest working lamps each frame; the rest keep bulb + glow only.
 */
export class StreetLamps {
  readonly root = new Group();
  readonly lights: SpotLight[] = [];
  private readonly bodyGeometry: BufferGeometry;
  private readonly bulbGeometry = new BoxGeometry(0.3, 0.06, 0.22);
  private readonly glowGeometry = new PlaneGeometry(GLOW_SIZE, GLOW_SIZE).rotateX(-Math.PI / 2);
  private readonly bodyMaterial = placeholderMaterial(LAMP_GREY);
  private readonly bulbMaterial: MeshStandardMaterial = placeholderMaterial('#ffd9a0');
  private readonly glowMaterial: MeshBasicMaterial;
  private glow: InstancedMesh | undefined;
  /** Instanced lamp meshes (rebuilt by `setLamps`). */
  private meshes: InstancedMesh[] = [];
  private readonly budget: LightBudget;
  private active: number[] = [];
  private preset: CompiledPreset['lamps'] | undefined;
  private level = 1;

  constructor(
    private lamps: readonly LampDef[],
    options: StreetLampsOptions = {},
  ) {
    this.root.name = 'street-lamps';
    this.budget = options.budget ?? DEFAULT_LIGHT_BUDGET;
    const shadowed = options.shadowedLights ?? 2;

    const pole = new CylinderGeometry(0.08, 0.12, LAMP_POLE_HEIGHT, 6).translate(
      0,
      LAMP_POLE_HEIGHT / 2,
      0,
    );
    const arm = new BoxGeometry(LAMP_ARM_LENGTH + 0.1, 0.08, 0.1).translate(
      LAMP_ARM_LENGTH / 2,
      4.35,
      0,
    );
    const head = new BoxGeometry(0.5, 0.18, 0.35).translate(LAMP_ARM_LENGTH, 4.3, 0);
    this.bodyGeometry = mergeGeometries([pole, arm, head]) ?? pole;
    for (const g of [pole, arm, head]) if (g !== this.bodyGeometry) g.dispose();
    this.bulbGeometry.translate(LAMP_ARM_LENGTH, 4.2, 0);

    this.glowMaterial = new MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: true,
    });
    this.build();

    for (let i = 0; i < this.budget.maxLights; i++) {
      const s = new SpotLight();
      s.name = `lamp-light-${i}`;
      s.castShadow = i < shadowed;
      if (s.castShadow) {
        const size = LIGHTING_CONFIG.lampShadowMapSize;
        s.shadow.mapSize.set(size, size);
        s.shadow.radius = LIGHTING_CONFIG.lampShadowRadius;
        s.shadow.bias = LIGHTING_CONFIG.lampShadowBias;
      }
      s.intensity = 0;
      this.lights.push(s);
      this.root.add(s, s.target);
    }
  }

  /** Body, bulb and glow instances of the current lamp list. */
  private build(): void {
    const lamps = this.lamps;
    const working = lamps.filter((l) => l.working);
    const body = this.instanced(this.bodyGeometry, this.bodyMaterial, lamps, 'lamp-body');
    body.castShadow = true;
    body.receiveShadow = true;
    this.meshes.push(body);
    this.meshes.push(this.instanced(this.bulbGeometry, this.bulbMaterial, working, 'lamp-bulbs'));
    this.glow = undefined;
    if (working.length) {
      const glow = new InstancedMesh(this.glowGeometry, this.glowMaterial, working.length);
      glow.name = 'lamp-glow';
      const m = new Matrix4();
      working.forEach((l, i) => {
        const h = lampHead(l);
        glow.setMatrixAt(i, m.makeTranslation(h.x, GLOW_Y, h.z));
      });
      glow.computeBoundingSphere();
      glow.renderOrder = 1;
      this.root.add(glow);
      this.meshes.push(glow);
      this.glow = glow;
    }
  }

  /**
   * Replaces the lamp list (generated maps: the lamps around the player, rebuilt as it moves).
   * Same 3 draw calls; the light pool is reassigned on the next `update`.
   */
  setLamps(lamps: readonly LampDef[]): void {
    for (const m of this.meshes) {
      this.root.remove(m);
      m.dispose();
    }
    this.meshes = [];
    this.lamps = lamps;
    this.active = [];
    this.build();
    this.refreshLevel();
    this.assign();
  }

  /** Lamp look from a preset (a day preset would set intensity 0, glow 0, no emission). */
  apply(p: LightingPreset['lamps']): void {
    this.applyCompiled(compilePreset({ ...NIGHT_PRESET, lamps: p }).lamps);
  }

  /** Allocation-free lamp look (day cycle, every frame); combined with `setLevel`. */
  applyCompiled(p: CompiledPreset['lamps']): void {
    this.preset = p;
    this.bulbMaterial.color.copy(p.bulbColor);
    this.bulbMaterial.emissive.copy(p.bulbEmissive);
    for (const s of this.lights) {
      s.color.copy(p.color);
      s.distance = p.distance;
      s.angle = p.angle;
      s.penumbra = p.penumbra;
      s.decay = p.decay;
    }
    this.refreshLevel();
  }

  /**
   * Lamps on/off with fade, 0..1: scales light intensity, bulb emission and glow. Crossing 0
   * toggles shadow updates; the light count never changes (no shader recompiles).
   */
  setLevel(level: number): void {
    const next = Math.min(1, Math.max(0, level));
    if (next === this.level) return;
    const toggled = next === 0 || this.level === 0;
    this.level = next;
    if (toggled) this.assign();
    else this.refreshLevel();
  }

  get currentLevel(): number {
    return this.level;
  }

  private refreshLevel(): void {
    const p = this.preset;
    if (!p) return;
    this.bulbMaterial.emissiveIntensity = p.bulbEmissiveIntensity * this.level;
    this.glowMaterial.opacity = p.glow * this.level;
    if (this.glow) this.glow.visible = p.glow * this.level > 0;
    const on = p.intensity * this.level > 0;
    if (!on) return this.assign();
    for (let i = 0; i < this.lights.length; i++) {
      const s = this.lights[i]!;
      if (this.lamps[this.active[i] ?? -1]) s.intensity = p.intensity * this.level;
    }
  }

  /** Per frame: give the light pool to the lamps nearest to the focus (camera target). */
  update(focusX: number, focusZ: number): void {
    const next = selectLamps(this.lamps, focusX, focusZ, this.budget, this.active);
    if (next.length === this.active.length && next.every((v, i) => v === this.active[i])) return;
    this.active = next;
    this.assign();
  }

  /** Indices (into the lamp list) of lamps that currently have a real light. */
  get litLamps(): readonly number[] {
    return this.active;
  }

  dispose(): void {
    this.bodyGeometry.dispose();
    this.bulbGeometry.dispose();
    this.glowGeometry.dispose();
    this.bodyMaterial.dispose();
    this.bulbMaterial.dispose();
    this.glowMaterial.map?.dispose();
    this.glowMaterial.dispose();
    for (const s of this.lights) s.shadow.dispose();
    this.root.clear();
  }

  private assign(): void {
    const on = (this.preset?.intensity ?? 0) * this.level > 0;
    this.lights.forEach((s, i) => {
      const lamp = this.lamps[this.active[i] ?? -1];
      // Unused pool lights stay in the scene (same light count, no recompiles) but are dark
      // and skip their shadow pass.
      s.shadow.autoUpdate = Boolean(lamp && on && s.castShadow);
      if (!lamp || !on) {
        s.intensity = 0;
        // A shadow-casting light must render its map once, or the lit materials sample an
        // unallocated shadow texture and draw nothing (lamps off from the first frame, day).
        if (s.castShadow && !s.shadow.map) s.shadow.needsUpdate = true;
        return;
      }
      const h = lampHead(lamp);
      s.intensity = (this.preset?.intensity ?? 0) * this.level;
      s.position.set(h.x, LIGHTING_CONFIG.lampLightHeight, h.z);
      s.target.position.set(h.x, 0, h.z);
      s.target.updateMatrixWorld();
      s.shadow.needsUpdate = true;
    });
  }

  private instanced(
    geometry: BufferGeometry,
    material: MeshStandardMaterial,
    list: readonly LampDef[],
    name: string,
  ): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, Math.max(1, list.length));
    mesh.name = name;
    mesh.count = list.length;
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const one = new Vector3(1, 1, 1);
    const p = new Vector3();
    list.forEach((l, i) => {
      q.setFromEuler(e.set(0, lampRotationY(l), 0));
      mesh.setMatrixAt(i, m.compose(p.set(l.x, 0, l.z), q, one));
    });
    mesh.computeBoundingSphere();
    this.root.add(mesh);
    return mesh;
  }
}

/** Radial warm glow (spec: rgba(255,160,70,.5) -> 0), drawn once to a small canvas. */
function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,160,70,.5)');
    g.addColorStop(0.5, 'rgba(255,160,80,.15)');
    g.addColorStop(1, 'rgba(255,150,70,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = 'srgb';
  return t;
}
