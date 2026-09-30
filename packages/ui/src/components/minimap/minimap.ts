import { defaultDoc, el, type Doc, type Mounted } from '../../dom/h.js';
import {
  MINIMAP_INNER_RADIUS,
  MINIMAP_NORTH_RADIUS,
  MINIMAP_PX_PER_M,
  MINIMAP_ROAD_WIDTH_M,
  effectiveYaw,
  northLetterDeg,
  northMarker,
  playerMarkerDeg,
  projectToMinimap,
  worldLayerTransform,
  type MinimapOrientation,
  type Vec2,
} from './projection.js';

export type Polyline = readonly Vec2[];
export type Polygon = readonly Vec2[];

/** Spec §5 MinimapVM. Coordinates in metres on the world floor plane. */
export interface MinimapVM {
  player: Vec2 & { heading: number };
  cameraYaw: number;
  roads: readonly Polyline[];
  buildings: readonly Polygon[];
  pois: readonly (Vec2 & { kind: 'objective' | 'poi' })[];
  /** Only enemies the player saw or heard. */
  enemies: readonly Vec2[];
}

export interface MinimapOptions {
  /** Default `north-up` (Paweł's decision; "N" fixed at the top). `camera` rotates with the camera. */
  orientation?: MinimapOrientation;
  /** Road width in metres (default MINIMAP_ROAD_WIDTH_M = 6 m). */
  roadWidth?: number;
  onOpen?: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const R = MINIMAP_INNER_RADIUS;

/** Round minimap drawn in SVG; north-up by default, optionally rotating with the camera. */
export function createMinimap(
  vm: MinimapVM,
  options: MinimapOptions = {},
  doc: Doc = defaultDoc(),
): Mounted<MinimapVM> & { setOrientation(o: MinimapOrientation): void } {
  let orientation = options.orientation ?? 'north-up';
  const roadWidth = options.roadWidth ?? MINIMAP_ROAD_WIDTH_M;
  const root = el(doc, 'div', 'dz-minimap');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Minimapa');
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    options.onOpen?.();
  });

  const svg = svgEl(doc, 'svg', {
    class: 'dz-minimap__svg',
    viewBox: `${-R} ${-R} ${2 * R} ${2 * R}`,
    width: String(2 * R),
    height: String(2 * R),
  });
  const world = svgEl(doc, 'g', { class: 'dz-minimap__world' });
  const roads = svgEl(doc, 'g', { class: 'dz-minimap__roads', 'stroke-width': String(roadWidth) });
  const buildings = svgEl(doc, 'g', { class: 'dz-minimap__buildings' });
  world.append(roads, buildings);
  const dots = svgEl(doc, 'g', { class: 'dz-minimap__dots' });
  const player = svgEl(doc, 'path', { class: 'dz-minimap__player', d: 'M0 -6.5 L7 6.5 L-7 6.5 Z' });
  const north = svgEl(doc, 'text', {
    class: 'dz-minimap__north',
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
  });
  north.textContent = 'N';
  svg.append(world, dots, player, north);
  root.appendChild(svg);

  let roadsRef: MinimapVM['roads'] | undefined;
  let buildingsRef: MinimapVM['buildings'] | undefined;
  let last = vm;

  const update = (m: MinimapVM): void => {
    last = m;
    root.dataset.orientation = orientation;
    const yaw = effectiveYaw(m.cameraYaw, orientation);
    // Static geometry is rebuilt only when the arrays change identity.
    if (m.roads !== roadsRef) {
      roadsRef = m.roads;
      roads.replaceChildren(
        ...m.roads.map((line) => svgEl(doc, 'polyline', { points: pts(line) })),
      );
    }
    if (m.buildings !== buildingsRef) {
      buildingsRef = m.buildings;
      buildings.replaceChildren(
        ...m.buildings.map((poly) => svgEl(doc, 'polygon', { points: pts(poly) })),
      );
    }
    world.setAttribute('transform', worldLayerTransform(m.player, yaw, MINIMAP_PX_PER_M));
    const dotEls: Element[] = [];
    for (const e of m.enemies)
      dotEls.push(dot(doc, projectToMinimap(e, m.player, yaw), 2.5, 'enemy'));
    for (const p of m.pois) dotEls.push(dot(doc, projectToMinimap(p, m.player, yaw), 5, p.kind));
    dots.replaceChildren(...dotEls);
    player.setAttribute('transform', `rotate(${playerMarkerDeg(m.player.heading, yaw)})`);
    const n = northMarker(yaw, MINIMAP_NORTH_RADIUS);
    north.setAttribute('x', String(n.x));
    north.setAttribute('y', String(n.y));
    // The letter turns with the map (its top points away from the centre).
    north.setAttribute('transform', `rotate(${northLetterDeg(yaw)} ${n.x} ${n.y})`);
  };
  update(vm);
  return {
    el: root,
    update,
    destroy: () => root.remove(),
    setOrientation(o) {
      orientation = o;
      update(last);
    },
  };
}

function svgEl(doc: Doc, tag: string, attrs: Record<string, string>): SVGElement {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function dot(doc: Doc, p: { x: number; y: number }, r: number, kind: string): SVGElement {
  return svgEl(doc, 'circle', {
    class: `dz-minimap__dot`,
    'data-kind': kind,
    cx: fmt(p.x),
    cy: fmt(p.y),
    r: String(r),
  });
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100 + 0);
const pts = (line: readonly Vec2[]): string => line.map((p) => `${fmt(p.x)},${fmt(p.z)}`).join(' ');
