import { describe, expect, it } from 'vitest';
import { PLAYER_MAP_TRAIL_MAX_POINTS, PLAYER_MAP_TRAIL_SPACING_M } from '@deadzone/protocol';
import {
  MARKER_TEXT_MAX_UNITS,
  TRAIL_BREAK_M,
  TRAIL_MAX_POINTS,
  markerTextLength,
  decodeBase64,
  fogGrid,
  MARKER_TEXT_MAX,
  ZOOM_MAX,
  ZOOM_MIN,
  clampMarkerText,
  cursorText,
  discoveredCount,
  discoveredText,
  distanceText,
  gridCell,
  isDiscovered,
  panelPosition,
  placeLabels,
  scaleBar,
  screenToWorld,
  setDiscovered,
  stepZoom,
  trailSegments,
  worldToScreen,
  zoomAround,
  zoomText,
} from './bigmap-model.js';

const vp = { width: 1280, height: 720 };

describe('zoom', () => {
  it('steps ×1.25 and clamps to 0.25–4', () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.25);
    expect(stepZoom(1, -1)).toBeCloseTo(0.8);
    expect(stepZoom(3.9, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN * 1.04, -1)).toBe(ZOOM_MIN);
    expect(zoomText(1)).toBe('1,0×');
    expect(zoomText(0.5)).toBe('0,50×');
  });

  it('keeps the world point under the cursor', () => {
    const v = { center: { x: 100, y: -40 }, zoom: 1 };
    const before = screenToWorld(v, vp, 900, 200);
    const next = zoomAround(v, vp, 900, 200, 2.5);
    const after = screenToWorld(next, vp, 900, 200);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    const s = worldToScreen(next, vp, before.x, before.y);
    expect(s.x).toBeCloseTo(900, 6);
  });

  it('scale bar is a round length 120–200 px long', () => {
    for (let z = ZOOM_MIN; z <= ZOOM_MAX; z *= 1.25) {
      const b = scaleBar(z);
      expect(b.px).toBeGreaterThanOrEqual(120);
      expect(b.px).toBeLessThanOrEqual(200);
      expect(b.labels[0]).toBe('0');
    }
    expect(scaleBar(1).labels[2]).toMatch(/ (m|km)$/);
  });
});

describe('texts', () => {
  it('grid cell A… / 1… from the map origin (bounds)', () => {
    const g = fogGrid({ cx0: 0, cy0: 0, cx1: 249, cy1: 249 }); // 8 km
    expect(gridCell(g, 10, 10)).toBe('A1');
    expect(gridCell(g, 7999, 7999)).toBe('H8');
    expect(gridCell(g, -1, 0)).toBe('–');
    expect(cursorText(g, 4150, 4610)).toBe('E5 · 4 150 / 4 610 m');
    const shifted = fogGrid({ cx0: 10, cy0: 10, cx1: 41, cy1: 41 });
    expect(gridCell(shifted, 320, 320)).toBe('A1');
    expect(cursorText(shifted, 1320, 330)).toBe('B1 · 1 000 / 10 m');
  });

  it('distance', () => {
    expect(distanceText(970.4)).toBe('970 m');
    expect(distanceText(1234)).toBe('1,2 km');
  });

  it('marker text is cut at 40 characters (code points)', () => {
    const t = 'źdźbło żółwia '.repeat(5);
    expect([...clampMarkerText(t)].length).toBe(MARKER_TEXT_MAX);
    expect(clampMarkerText('Stacja benzynowa')).toBe('Stacja benzynowa');
  });
});

describe('fog bitmap', () => {
  it('bit (cy − cy0) · width + (cx − cx0): byte i >> 3, mask 1 << (i & 7), counted', () => {
    const fog = fogGrid({ cx0: 4, cy0: 2, cx1: 19, cy1: 9 }); // 16 × 8
    expect(fog.bits.length).toBe(16);
    expect(setDiscovered(fog, 7, 2)).toBe(true);
    expect(fog.bits[0]).toBe(1 << 3);
    expect(setDiscovered(fog, 7, 2)).toBe(false);
    setDiscovered(fog, 4, 3); // index 16 → byte 2, bit 0
    expect(fog.bits[2]).toBe(1);
    expect(isDiscovered(fog, 4, 3)).toBe(true);
    expect(isDiscovered(fog, 5, 3)).toBe(false);
    expect(isDiscovered(fog, 3, 2)).toBe(false);
    expect(setDiscovered(fog, 20, 2)).toBe(false);
    expect(discoveredCount(fog)).toBe(2);
    expect(discoveredText(fog).count).toBe('2');
    expect(discoveredText(fog).rest).toBe(` / 128 chunków (1,6 %)`);
  });

  it('decodes the sim base64 bitmap', () => {
    expect([...decodeBase64(btoa(String.fromCharCode(1, 128, 255)))]).toEqual([1, 128, 255]);
  });

  it('defaults to the protocol map (512 × 512 chunks)', () => {
    const g = fogGrid();
    expect([g.width, g.height, g.bits.length]).toEqual([512, 512, 32768]);
  });
});

describe('trail', () => {
  it('breaks on NaN and on long jumps', () => {
    const t = Float32Array.from([0, 0, 16, 0, 32, 0, NaN, NaN, 500, 500, 516, 500, 900, 900]);
    const segs = trailSegments(t);
    expect(segs.map((s) => s.length)).toEqual([3, 2]);
    expect(segs[1]![0]).toEqual({ x: 500, y: 500 });
  });
});

describe('layout', () => {
  it('labels move r → b → t → l on collision', () => {
    const sides = placeLabels([
      { x: 100, y: 100, w: 80, h: 20 },
      { x: 100, y: 118, w: 80, h: 20 },
    ]);
    expect(sides[0]).toBe('r');
    expect(sides[1]).not.toBe('r');
  });

  it('edit panel flips left near the right edge and stays inside', () => {
    expect(panelPosition(300, 300, 320, 400, vp)).toEqual({ x: 344, y: 254, flipped: false });
    const p = panelPosition(1100, 700, 320, 400, vp);
    expect(p.flipped).toBe(true);
    expect(p.x).toBe(1100 - 44 - 320);
    expect(p.y + 400).toBeLessThanOrEqual(720 - 38);
  });
});

describe('protocol limits (Serwer #133)', () => {
  it('marker text counts code points: emoji = 1, cut at 40', () => {
    const emoji = '🧟'.repeat(40);
    expect(emoji.length).toBe(80);
    expect(markerTextLength(emoji)).toBe(40);
    expect(clampMarkerText(emoji + '🧟')).toBe(emoji);
    expect(MARKER_TEXT_MAX_UNITS).toBe(80);
  });

  it('trail break and cap from the protocol', () => {
    expect(TRAIL_BREAK_M).toBe(4 * PLAYER_MAP_TRAIL_SPACING_M);
    expect(TRAIL_MAX_POINTS).toBe(PLAYER_MAP_TRAIL_MAX_POINTS);
  });
});
