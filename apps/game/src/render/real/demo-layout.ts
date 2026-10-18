/** A model of the dev demo layout (metres from the demo point, world axes). */
export interface DemoPlacement {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly rotY?: number;
  readonly scale?: number;
}

/**
 * `?pbrdemo=x,z`: Designer's pilot scene (`style-real.png`) — two blocks of flats, two houses, a
 * bin shelter, parked sedans, trees and bushes — on open ground next to the start.
 */
export const DEMO_LAYOUT: readonly DemoPlacement[] = [
  // Building pivots are at a base corner (sizes: p4 58 × 14 m, p10 29 × 16 m, houses ~10–15 m).
  { id: 'blok-p4', x: -34, z: -34 },
  { id: 'blok-p10', x: 28, z: -36 },
  { id: 'dom-kostka-namiot', x: -24, z: 6 },
  { id: 'dom-90', x: 8, z: 8 },
  { id: 'smietnik', x: -6, z: -14 },
  // Kenney sedan: long axis z, centred pivot.
  { id: 'sedan', x: -9, z: -6, rotY: Math.PI / 2 },
  { id: 'sedan', x: -2, z: -6, rotY: Math.PI / 2 },
  { id: 'sedan', x: 7, z: -5.5, rotY: -Math.PI / 2 },
  { id: 'drzewo-lisciaste', x: -12, z: 2 },
  { id: 'drzewo-lisciaste', x: 4, z: -14, scale: 1.1 },
  { id: 'drzewo-lisciaste', x: 22, z: -2, scale: 0.9 },
  { id: 'drzewo-lisciaste', x: -30, z: -6, scale: 1.05 },
  { id: 'krzak', x: 5, z: 3 },
  { id: 'krzak', x: 6.5, z: 4.2, scale: 0.8 },
  { id: 'krzak', x: -15, z: 8 },
  { id: 'krzak', x: -14, z: 9.6, scale: 1.2 },
];
