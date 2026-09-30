import type { Doc } from '../dom/h.js';
import { iconPaths, iconShapes, type IconName } from './paths.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const isIconName = (name: string): name is IconName => Object.hasOwn(iconPaths, name);

/** Stroke icon in `currentColor`. Unknown names return `null` (slot shows no icon). */
export function createIcon(doc: Doc, name: string, size: number): SVGSVGElement | null {
  if (!isIconName(name)) return null;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: 'dz-icon',
  })) {
    svg.setAttribute(k, v);
  }
  svg.dataset.icon = name;
  for (const shape of iconShapes[name] ?? []) {
    const node = doc.createElementNS(SVG_NS, shape.tag);
    for (const [k, v] of Object.entries(shape.attrs)) node.setAttribute(k, v);
    svg.appendChild(node);
  }
  for (const d of iconPaths[name]) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}
