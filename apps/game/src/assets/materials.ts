import { Mesh, type Material, type Object3D } from 'three';

/**
 * Shared materials by name (e.g. `kenney-survival/palette`): every mesh of a palette pack uses
 * one THREE material, so the renderer shares one program and one texture.
 */
export class MaterialRegistry {
  private readonly byName = new Map<string, Material>();

  get size(): number {
    return this.byName.size;
  }

  register(name: string, material: Material): void {
    if (this.byName.has(name)) throw new Error(`materiał ${name} już zarejestrowany`);
    material.name = name;
    this.byName.set(name, material);
  }

  get(name: string): Material | undefined {
    return this.byName.get(name);
  }

  /**
   * Replaces materials whose name is registered by the shared instance and disposes the
   * loader's placeholders. Returns how many meshes were rebound.
   */
  bind(root: Object3D): number {
    let n = 0;
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const cur = o.material as Material;
      const shared = this.byName.get(cur.name);
      if (!shared || shared === cur) return;
      cur.dispose();
      o.material = shared;
      n++;
    });
    return n;
  }

  dispose(): void {
    for (const m of this.byName.values()) m.dispose();
    this.byName.clear();
  }
}
