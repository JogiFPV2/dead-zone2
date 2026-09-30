import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { LEVEL_HEIGHT } from '../world/instances.js';
import { zoneMeshData, type MapZone } from '../world/zones.js';

/**
 * Dev-only `?zones=1`: translucent flat rects per map zone, coloured by role, plus outlines.
 * Two draw calls in total; a debug tool, not the final look.
 */
export function createZonesOverlay(zones: readonly MapZone[]): Group {
  const d = zoneMeshData(zones, LEVEL_HEIGHT);
  const fill = new BufferGeometry();
  fill.setAttribute('position', new BufferAttribute(d.positions, 3));
  fill.setAttribute('color', new BufferAttribute(d.colors, 3));
  fill.setIndex(new BufferAttribute(d.indices, 1));
  const lines = new BufferGeometry();
  lines.setAttribute('position', new BufferAttribute(d.outline, 3));
  lines.setAttribute('color', new BufferAttribute(d.outlineColors, 3));
  const group = new Group();
  group.name = 'dev-zones';
  const mesh = new Mesh(
    fill,
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const outline = new LineSegments(lines, new LineBasicMaterial({ vertexColors: true }));
  mesh.renderOrder = outline.renderOrder = 1;
  group.add(mesh, outline);
  return group;
}
