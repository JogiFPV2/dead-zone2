// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { clampOsmZoom, createOsmMap, tilesInView } from './osm-map.js';
import { STW2_ORIGIN } from './osm-geo.js';

describe('osm-map', () => {
  it('requests only the tiles in view', () => {
    // 320×200 box centred in the middle of tile (10, 20): one tile row, two columns at most.
    expect(tilesInView(10.5, 20.5, 16, 320, 200)).toEqual([
      { x: 9, y: 20 },
      { x: 10, y: 20 },
      { x: 11, y: 20 },
    ]);
    expect(tilesInView(10.5, 20.5, 16, 100, 100)).toEqual([{ x: 10, y: 20 }]);
  });

  it('clamps the zoom to 10–19', () => {
    expect(clampOsmZoom(3)).toBe(10);
    expect(clampOsmZoom(25)).toBe(19);
    expect(clampOsmZoom(Number.NaN)).toBe(16);
  });

  it('shows attribution, and a note instead of tiles off the real map', () => {
    const m = createOsmMap({ tileUrl: 'https://tiles.test' });
    const attr = m.el.querySelector<HTMLAnchorElement>('.dz-osm__attr')!;
    expect(attr.textContent).toBe('© OpenStreetMap');
    expect(attr.href).toBe('https://www.openstreetmap.org/copyright');
    m.update(undefined, 0);
    expect(m.el.querySelector<HTMLElement>('.dz-osm__off')!.hidden).toBe(false);
    expect(m.el.querySelectorAll('img').length).toBe(0);
  });

  it('+ / − change the zoom and report it', () => {
    const seen: number[] = [];
    const m = createOsmMap({ zoom: 18, onZoom: (z) => seen.push(z) });
    m.update(STW2_ORIGIN, 0);
    m.el.querySelector<HTMLButtonElement>('[data-z="1"]')!.click();
    m.el.querySelector<HTMLButtonElement>('[data-z="1"]')!.click();
    expect(m.zoom).toBe(19);
    m.el.querySelector<HTMLButtonElement>('[data-z="-1"]')!.click();
    expect(seen).toEqual([19, 18]);
  });
});
