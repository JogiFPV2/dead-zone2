// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  createMinimap,
  MINIMAP_NORTH_RADIUS,
  MINIMAP_PX_PER_M,
  MINIMAP_ROAD_WIDTH_M,
  northLetterDeg,
  northMarker,
  playerMarkerDeg,
  projectToMinimap,
  worldLayerTransform,
  type MinimapVM,
} from './index.js';

const ISO_YAW = Math.PI / 4;
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('minimap projection', () => {
  const player = { x: 10, z: 10 };

  it('north-up (yaw 0): north (−z) is up, east (+x) is right, 2.5 px per metre', () => {
    close(projectToMinimap({ x: 10, z: 0 }, player, 0), { x: 0, y: -25 });
    close(projectToMinimap({ x: 20, z: 10 }, player, 0), { x: 25, y: 0 });
  });

  it('camera orientation: what is up on screen is up on the map', () => {
    // Screen-up on the ground for the iso camera is (−sin yaw, −cos yaw).
    const up = { x: 10 - Math.sin(ISO_YAW) * 10, z: 10 - Math.cos(ISO_YAW) * 10 };
    close(projectToMinimap(up, player, ISO_YAW), { x: 0, y: -25 });
    // Screen-right is (cos yaw, −sin yaw).
    const right = { x: 10 + Math.cos(ISO_YAW) * 4, z: 10 - Math.sin(ISO_YAW) * 4 };
    close(projectToMinimap(right, player, ISO_YAW), { x: 10, y: 0 });
  });

  it('the world layer transform matches the point projection', () => {
    expect(worldLayerTransform(player, ISO_YAW)).toBe('rotate(45) scale(2.5) translate(-10 -10)');
  });

  it('player marker follows facing (sim facingRad) plus camera yaw', () => {
    expect(playerMarkerDeg(-Math.PI / 2, 0)).toBe(0); // facing north, north-up → pointing up
    expect(playerMarkerDeg(0, 0)).toBe(90); // facing east → pointing right
    expect(playerMarkerDeg(-Math.PI / 2 - ISO_YAW, ISO_YAW)).toBe(0);
  });

  it('"N" orbits the rim with the camera, 8 px in from the edge', () => {
    expect(MINIMAP_NORTH_RADIUS).toBe(90); // inner radius 98 − 8
    close(northMarker(0, 90), { x: 0, y: -90 });
    close(northMarker(Math.PI / 2, 90), { x: 90, y: 0 });
    expect(northLetterDeg(ISO_YAW)).toBe(45);
  });

  it('roads are 6 m wide and the scale does not depend on the camera view height', () => {
    expect(MINIMAP_ROAD_WIDTH_M).toBe(6);
    expect(MINIMAP_PX_PER_M).toBe(2.5); // metres → px only; VIEW_HEIGHT (24) plays no part
  });
});

const vm = (over: Partial<MinimapVM> = {}): MinimapVM => ({
  player: { x: 0, z: 0, heading: 0 },
  cameraYaw: ISO_YAW,
  roads: [
    [
      { x: -40, z: 0 },
      { x: 40, z: 0 },
    ],
  ],
  buildings: [
    [
      { x: 5, z: 5 },
      { x: 15, z: 5 },
      { x: 15, z: 15 },
      { x: 5, z: 15 },
    ],
  ],
  pois: [{ x: 0, z: -20, kind: 'objective' }],
  enemies: [{ x: 4, z: 0 }],
  ...over,
});

describe('Minimap element', () => {
  it('draws roads, buildings, POIs, enemies, player and N; north-up by default', () => {
    const map = createMinimap(vm(), {}, document);
    expect(map.el.dataset.orientation).toBe('north-up'); // default (Paweł's decision)
    expect(map.el.querySelectorAll('polyline')).toHaveLength(1);
    expect(map.el.querySelectorAll('polygon')).toHaveLength(1);
    const dots = [...map.el.querySelectorAll('circle')].map((c) => [
      c.getAttribute('data-kind'),
      c.getAttribute('r'),
    ]);
    expect(dots).toEqual([
      ['enemy', '2.5'],
      ['objective', '5'],
    ]);
    // Camera yaw is ignored: north (−z) stays up.
    expect(map.el.querySelector('.dz-minimap__world')?.getAttribute('transform')).toBe(
      'rotate(0) scale(2.5) translate(0 0)',
    );
    expect(map.el.querySelector('polyline')?.parentElement?.getAttribute('stroke-width')).toBe('6');
    const n = map.el.querySelector('.dz-minimap__north');
    expect(n?.textContent).toBe('N');
    expect(n?.getAttribute('x')).toBe('0');
    expect(n?.getAttribute('y')).toBe('-90');
    expect(n?.getAttribute('transform')).toBe('rotate(0 0 -90)');
  });

  it('north-up: "N" stays fixed at the top whatever the camera does', () => {
    const map = createMinimap(vm(), {}, document);
    for (const cameraYaw of [0, ISO_YAW, Math.PI, -2]) {
      map.update(vm({ cameraYaw }));
      const n = map.el.querySelector('.dz-minimap__north');
      expect([n?.getAttribute('x'), n?.getAttribute('y')]).toEqual(['0', '-90']);
      expect(n?.getAttribute('transform')).toBe('rotate(0 0 -90)');
      expect(map.el.querySelector('.dz-minimap__world')?.getAttribute('transform')).toBe(
        'rotate(0) scale(2.5) translate(0 0)',
      );
    }
  });

  it('option: rotate with the camera ("N" orbits the rim and turns with the map)', () => {
    const map = createMinimap(vm(), { orientation: 'camera' }, document);
    expect(map.el.dataset.orientation).toBe('camera');
    expect(map.el.querySelector('.dz-minimap__world')?.getAttribute('transform')).toBe(
      'rotate(45) scale(2.5) translate(0 0)',
    );
    const n = map.el.querySelector('.dz-minimap__north');
    expect(n?.getAttribute('transform')).toBe(
      `rotate(45 ${n?.getAttribute('x')} ${n?.getAttribute('y')})`,
    );
    map.setOrientation('north-up');
    expect(map.el.dataset.orientation).toBe('north-up');
    expect(n?.getAttribute('y')).toBe('-90');
    expect(n?.getAttribute('transform')).toBe('rotate(0 0 -90)');
  });

  it('rebuilds static geometry only when the arrays change', () => {
    const data = vm();
    const map = createMinimap(data, {}, document);
    const road = map.el.querySelector('polyline');
    map.update({ ...data, player: { x: 3, z: 1, heading: 1 } });
    expect(map.el.querySelector('polyline')).toBe(road);
  });

  it('opens the full map on click without reaching the game', () => {
    const onOpen = vi.fn();
    const outer = vi.fn();
    const map = createMinimap(vm(), { onOpen }, document);
    document.body.addEventListener('click', outer);
    document.body.appendChild(map.el);
    map.el.click();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
    map.destroy();
  });
});
