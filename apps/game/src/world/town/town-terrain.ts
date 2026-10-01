import { Group, Mesh, MeshStandardMaterial, type Texture } from 'three';
import type { ChunkRange, ChunkSource } from '../chunk.js';
import { LEVEL_HEIGHT } from '../instances.js';
import type { TownKit } from './kit.js';
import { buildTerrainGeometry } from './terrain-mesh.js';
import { MapTiles } from './tiles.js';

/**
 * Terrain material: vertex colours modulated by one RGBA detail texture (two scales), channel
 * picked per vertex by `dmask` (spec 5). Surfaces with an empty mask keep the flat colour.
 */
export function terrainMaterial(detail: Texture): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.name = 'deadzone-town/terrain';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 dmask; varying vec4 vMask; varying vec2 vWXZ;',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvMask = dmask; vWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D detailMap; varying vec4 vMask; varying vec2 vWXZ;',
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'vec4 dt = texture2D(detailMap, vWXZ * 0.25);',
          'vec4 dt2 = texture2D(detailMap, vWXZ * 0.061 + 0.37);',
          'float dsum = min(vMask.x + vMask.y + vMask.z + vMask.w, 1.0);',
          'float dd = dot(dt * 0.65 + dt2 * 0.35, vMask) + (1.0 - dsum) * 0.5;',
          'diffuseColor.rgb *= dsum > 0.0 ? mix(0.62, 1.38, dd) : 1.0;',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'deadzone-town-terrain';
  return m;
}

/** One merged mesh per chunk (tiles, curbs, paint, stains): 1 draw call per chunk. */
export class TownTerrain {
  readonly root = new Group();
  private readonly material: MeshStandardMaterial;

  constructor(
    private readonly source: ChunkSource,
    private readonly kit: TownKit,
  ) {
    this.root.name = 'town-terrain';
    this.material = terrainMaterial(kit.detail);
  }

  loadRange(range: ChunkRange): void {
    const tiles = new MapTiles(this.source, range.z);
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        const g = buildTerrainGeometry(tiles, cx, cy, this.kit.cells, range.z * LEVEL_HEIGHT);
        if (!g) continue;
        const mesh = new Mesh(g, this.material);
        mesh.name = `terrain:${cx},${cy},${range.z}`;
        mesh.receiveShadow = true;
        this.root.add(mesh);
      }
    }
  }

  dispose(): void {
    for (const c of this.root.children) (c as Mesh).geometry.dispose();
    this.material.dispose();
    this.root.clear();
  }
}
