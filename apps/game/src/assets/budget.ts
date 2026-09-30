/** GPU memory estimates and a simple budget tracker (pure; no three.js). */

export const DEFAULT_GPU_BUDGET_BYTES = 256 * 1024 * 1024;

/** A full mip chain adds 1/4 + 1/16 + … ≈ 1/3 of the base level. */
const MIP_FACTOR = 4 / 3;

/** Uncompressed texture: width × height × bytes per pixel (RGBA8 = 4). */
export function textureBytes(
  width: number,
  height: number,
  bytesPerPixel = 4,
  mipmaps = true,
): number {
  return Math.ceil(width * height * bytesPerPixel * (mipmaps ? MIP_FACTOR : 1));
}

/** Block-compressed texture (4×4 blocks; BC7/ASTC/ETC2-RGBA = 16 B, BC1/ETC1 = 8 B). */
export function compressedTextureBytes(
  width: number,
  height: number,
  blockBytes = 16,
  mipmaps = true,
): number {
  const blocks = Math.ceil(width / 4) * Math.ceil(height / 4);
  return Math.ceil(blocks * blockBytes * (mipmaps ? MIP_FACTOR : 1));
}

export interface BufferInfo {
  count: number;
  itemSize: number;
  bytesPerElement: number;
}

/** Vertex attributes + index buffer as uploaded to the GPU. */
export function geometryBytes(attributes: BufferInfo[], index?: BufferInfo): number {
  const size = (b: BufferInfo) => b.count * b.itemSize * b.bytesPerElement;
  return attributes.reduce((s, a) => s + size(a), 0) + (index ? size(index) : 0);
}

export function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Sums estimated bytes per key (e.g. asset URL); reports when the total crosses the limit. */
export class GpuBudget {
  private readonly entries = new Map<string, number>();
  private sum = 0;
  private wasOver = false;

  constructor(
    readonly limitBytes = DEFAULT_GPU_BUDGET_BYTES,
    /** Called once each time the total goes over the limit. */
    private readonly onOver?: (total: number, limit: number) => void,
  ) {}

  get total(): number {
    return this.sum;
  }

  get over(): boolean {
    return this.sum > this.limitBytes;
  }

  set(key: string, bytes: number): void {
    this.sum += bytes - (this.entries.get(key) ?? 0);
    this.entries.set(key, bytes);
    this.check();
  }

  remove(key: string): void {
    this.sum -= this.entries.get(key) ?? 0;
    this.entries.delete(key);
    this.check();
  }

  /** Dev overlay line, e.g. `GPU assets 12.3 / 256.0 MB` with a warning when over. */
  line(): string {
    const base = `GPU assets ${formatMB(this.sum)} / ${formatMB(this.limitBytes)}`;
    return this.over ? `${base} ⚠ OVER BUDGET` : base;
  }

  private check(): void {
    const over = this.over;
    if (over && !this.wasOver) this.onOver?.(this.sum, this.limitBytes);
    this.wasOver = over;
  }
}
