import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';

/**
 * Footprints in the snow (render only): every character that walks on level 0 leaves a print
 * every `stride` m, alternating left and right of its path, turned along it. Prints fade with age
 * (faster while it is still snowing: new snow fills them) and with the snow cover itself; a ring
 * buffer of `max` prints, one draw call. Coordinates are sim floor metres (x, y), placed under
 * the world root (sim x → world X, sim y → world Z).
 */
export const FOOTPRINTS = {
  max: 2048,
  /** Metres between two prints and sideways offset of a foot from the path. */
  stride: 0.75,
  side: 0.13,
  /** Print size (m): length along the path, width. */
  length: 0.3,
  width: 0.13,
  /** Real seconds until a print is gone: in still snow, and while it snows. */
  lifeSec: 600,
  lifeSnowingSec: 120,
  /** No prints below this snow cover. */
  minCover: 0.25,
} as const;

interface Walker {
  x: number;
  y: number;
  left: boolean;
  seen: number;
}

function printTexture(): CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  if (!g) return undefined;
  g.fillStyle = '#fff';
  // Sole and heel of a boot (long axis = canvas y).
  g.beginPath();
  g.ellipse(16, 22, 11, 18, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(16, 52, 9, 9, 0, 0, Math.PI * 2);
  g.fill();
  return new CanvasTexture(c);
}

export class Footprints {
  readonly mesh: InstancedMesh;
  private readonly born = new Float32Array(FOOTPRINTS.max);
  private readonly fade: InstancedBufferAttribute;
  private readonly walkers = new Map<string, Walker>();
  private next = 0;
  private count = 0;
  private frame = 0;
  private readonly m4 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scl = new Vector3(FOOTPRINTS.width, FOOTPRINTS.length, 1);
  private readonly axisX = new Vector3(1, 0, 0);
  private readonly axisY = new Vector3(0, 1, 0);
  private readonly qy = new Quaternion();

  constructor(parent: Object3D) {
    const geo = new PlaneGeometry(1, 1);
    const tex = printTexture();
    const mat = new MeshBasicMaterial({
      color: '#5f6b7a',
      transparent: true,
      depthWrite: false,
      ...(tex ? { alphaMap: tex } : {}),
    });
    // Per-instance opacity through the instance colour's red channel is not enough for alpha:
    // fade = an instanced attribute read in the shader.
    this.fade = new InstancedBufferAttribute(new Float32Array(FOOTPRINTS.max), 1);
    this.fade.setUsage(DynamicDrawUsage);
    geo.setAttribute('dzFade', this.fade);
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float dzFade; varying float vDzFade;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDzFade = dzFade;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDzFade;')
        .replace(
          '#include <alphamap_fragment>',
          '#include <alphamap_fragment>\ndiffuseColor.a *= vDzFade;',
        );
    };
    mat.customProgramCacheKey = () => 'dz-footprints';
    this.mesh = new InstancedMesh(geo, mat, FOOTPRINTS.max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'footprints';
    parent.add(this.mesh);
  }

  /** A character at sim (x, y) on `level` (only level 0 leaves prints). */
  step(id: string, x: number, y: number, level: number, cover: number, nowSec: number): void {
    const w = this.walkers.get(id);
    if (!w || level !== 0) {
      this.walkers.set(id, { x, y, left: false, seen: this.frame });
      return;
    }
    w.seen = this.frame;
    const dx = x - w.x;
    const dy = y - w.y;
    const d = Math.hypot(dx, dy);
    if (d > 8) {
      // Teleport / respawn: no trail across the gap.
      w.x = x;
      w.y = y;
      return;
    }
    if (d < FOOTPRINTS.stride) return;
    // Several prints when a slow frame covered more than one stride.
    const ux = dx / d;
    const uy = dy / d;
    let walked = 0;
    while (d - walked >= FOOTPRINTS.stride) {
      walked += FOOTPRINTS.stride;
      if (cover >= FOOTPRINTS.minCover)
        this.add(
          w.x + ux * (walked - FOOTPRINTS.stride / 2),
          w.y + uy * (walked - FOOTPRINTS.stride / 2),
          ux,
          uy,
          w.left,
          nowSec,
        );
      w.left = !w.left;
    }
    w.x += ux * walked;
    w.y += uy * walked;
  }

  private add(x: number, y: number, ux: number, uy: number, left: boolean, nowSec: number): void {
    const s = left ? FOOTPRINTS.side : -FOOTPRINTS.side;
    // Sideways = path direction turned 90° (sim plane), world X = sim x, world Z = sim y.
    this.pos.set(x - uy * s, 0.03, y + ux * s);
    // Lay the plane flat (−90° about X), then turn its long axis (local +Y → world −Z) along the path.
    this.q.setFromAxisAngle(this.axisX, -Math.PI / 2);
    this.qy.setFromAxisAngle(this.axisY, Math.atan2(-ux, -uy));
    this.q.premultiply(this.qy);
    this.m4.compose(this.pos, this.q, this.scl);
    const i = this.next;
    this.mesh.setMatrixAt(i, this.m4);
    this.born[i] = nowSec;
    this.next = (i + 1) % FOOTPRINTS.max;
    this.count = Math.min(FOOTPRINTS.max, this.count + 1);
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Per frame: fades by age and cover; `snowing` 0..1 shortens the life. */
  update(nowSec: number, cover: number, snowing: number): void {
    this.frame++;
    const life = FOOTPRINTS.lifeSec + (FOOTPRINTS.lifeSnowingSec - FOOTPRINTS.lifeSec) * snowing;
    const k = Math.min(1, Math.max(0, (cover - FOOTPRINTS.minCover * 0.5) / FOOTPRINTS.minCover));
    const a = this.fade.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const age = nowSec - (this.born[i] ?? 0);
      a[i] = age >= life ? 0 : 0.75 * k * (1 - age / life);
    }
    this.fade.needsUpdate = true;
    this.mesh.visible = this.count > 0 && k > 0;
    // Forget walkers not seen for a while (zombies streamed out).
    if (this.frame % 600 === 0)
      for (const [id, w] of this.walkers) if (this.frame - w.seen > 600) this.walkers.delete(id);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
