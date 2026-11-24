import { Color, Group, Mesh, MeshStandardMaterial, type Texture } from 'three';
import {
  PAINTED_GROUND,
  PAINTED_GROUND_GLSL,
  PAINTED_GROUND_PARS,
} from '../../render/painted-ground.js';
import type { ChunkRange, ChunkSource } from '../chunk.js';
import { LEVEL_HEIGHT } from '../instances.js';
import type { TownCells, TownKit } from './kit.js';
import { buildTerrainGeometry } from './terrain-mesh.js';
import { MapTiles } from './tiles.js';
import { PAINTED_BLD, PAINTED_BLD_PARS } from '../../render/painted-buildings.js';

/**
 * Palette colour of each painted ground layer (grass, asphalt, paving, earth, gravel): the
 * painted textures take the vertex colour relative to it (grass hues, worn verges, ruts).
 */
export function paintedGroundRefs(cells: TownCells | undefined): Color[] {
  if (!cells) return [0x5c7a3a, 0x4a4a4e, 0x9a958a, 0x7a6448, 0x8c8678].map((h) => new Color(h));
  const c = (n: string) => cells.color(n).clone();
  const grass = ['grass-c', 'grass', 'grass-b', 'grass-d']
    .map(c)
    .reduce((a, b) => a.add(b), new Color(0, 0, 0))
    .multiplyScalar(0.25);
  return [grass, c('asphalt'), c('sidewalk'), c('dirt'), c('dirt').lerp(c('concrete'), 0.5)];
}

/**
 * Terrain material: vertex colours modulated by one RGBA detail texture (two scales), channel
 * picked per vertex by `dmask` (spec 5). Surfaces with an empty mask keep the flat colour. In the
 * painted style (`PAINTED_GROUND.on`) the masked surfaces show painted textures instead.
 */
export function terrainMaterial(detail: Texture, cells?: TownCells): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.name = 'deadzone-town/terrain';
  const refs = { value: paintedGroundRefs(cells) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.uniforms.pgOn = PAINTED_GROUND.on;
    sh.uniforms.pgRef = refs;
    sh.uniforms.pgTrawa = PAINTED_GROUND.trawa;
    sh.uniforms.pgAsfalt = PAINTED_GROUND.asfalt;
    sh.uniforms.pgPlyty = PAINTED_GROUND.plyty;
    sh.uniforms.pgZiemia = PAINTED_GROUND.ziemia;
    sh.uniforms.pgSzuter = PAINTED_GROUND.szuter;
    Object.assign(sh.uniforms, PAINTED_BLD);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 dmask; varying vec4 vMask; varying vec2 vWXZ; varying vec3 vPbTW; uniform vec3 pbOrigin;',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvMask = dmask; vPbTW = (modelMatrix * vec4(transformed, 1.0)).xyz + pbOrigin; vWXZ = vPbTW.xz;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D detailMap; varying vec4 vMask; varying vec2 vWXZ; varying vec3 vPbTW;\n' +
          PAINTED_GROUND_PARS +
          PAINTED_BLD_PARS,
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
          PAINTED_GROUND_GLSL,
          // Painted indoor floors (no ground mask): wood, tiles, carpet by the room.
          'if (pbOn > 0.5 && vMask.x + vMask.y + vMask.z + vMask.w < 0.001) {',
          '  int pbR = pbRoomFloor(vPbTW.xz, vPbTW.y);',
          '  if (pbR > 0) diffuseColor.rgb = pbFloor(pbR, vPbTW.xz);',
          '}',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'deadzone-town-terrain-pb';
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
    this.material = kit.terrainMaterial ?? terrainMaterial(kit.detail, kit.cells);
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
