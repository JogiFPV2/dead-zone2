import { describe, expect, it } from 'vitest';
import { yawForStep } from '../camera/rotation.js';
import { NO_BUILDING } from './chunk.js';
import {
  NO_CUTAWAY,
  cameraSide,
  cutawayKey,
  edgeFacesCamera,
  isEdgeLowered,
  isLevelHidden,
  isRoofHidden,
  occludersOf,
  type Cutaway,
} from './cutaway.js';

describe('cameraSide', () => {
  it('follows each 90° step, also negative and wrapped', () => {
    expect(cameraSide(yawForStep(0))).toEqual({ sx: 1, sz: 1 });
    expect(cameraSide(yawForStep(1))).toEqual({ sx: 1, sz: -1 });
    expect(cameraSide(yawForStep(2))).toEqual({ sx: -1, sz: -1 });
    expect(cameraSide(yawForStep(3))).toEqual({ sx: -1, sz: 1 });
    expect(cameraSide(yawForStep(-1))).toEqual(cameraSide(yawForStep(3)));
    expect(cameraSide(yawForStep(5))).toEqual(cameraSide(yawForStep(1)));
  });
});

describe('edgeFacesCamera', () => {
  // Player on tile (5, 5): its borders are lines X=5, X=6, Z=5, Z=6.
  const faces = (step: number, axis: 'N' | 'W', ex: number, ey: number) =>
    edgeFacesCamera(axis, ex, ey, 5, 5, cameraSide(yawForStep(step)));

  it('step 0 (camera +X+Z): south and east lines', () => {
    expect(faces(0, 'N', 5, 6)).toBe(true);
    expect(faces(0, 'N', 5, 5)).toBe(false);
    expect(faces(0, 'W', 6, 5)).toBe(true);
    expect(faces(0, 'W', 5, 5)).toBe(false);
  });

  it('step 1 (camera +X-Z): north and east lines', () => {
    expect(faces(1, 'N', 5, 5)).toBe(true);
    expect(faces(1, 'N', 5, 6)).toBe(false);
    expect(faces(1, 'W', 6, 5)).toBe(true);
    expect(faces(1, 'W', 5, 5)).toBe(false);
  });

  it('step 2 (camera -X-Z): north and west lines', () => {
    expect(faces(2, 'N', 5, 5)).toBe(true);
    expect(faces(2, 'N', 5, 6)).toBe(false);
    expect(faces(2, 'W', 5, 5)).toBe(true);
    expect(faces(2, 'W', 6, 5)).toBe(false);
  });

  it('step 3 (camera -X+Z): south and west lines', () => {
    expect(faces(3, 'N', 5, 6)).toBe(true);
    expect(faces(3, 'N', 5, 5)).toBe(false);
    expect(faces(3, 'W', 5, 5)).toBe(true);
    expect(faces(3, 'W', 6, 5)).toBe(false);
  });

  it('ignores the perpendicular coordinate', () => {
    expect(faces(0, 'N', -40, 9)).toBe(true);
    expect(faces(0, 'W', 9, -40)).toBe(true);
  });
});

describe('cutaway state', () => {
  const c: Cutaway = { building: 3, tx: 5, ty: 5, side: { sx: 1, sz: 1 } };

  it('lowers only camera-facing edges of the current building', () => {
    expect(isEdgeLowered(c, 3, 'N', 5, 6)).toBe(true);
    expect(isEdgeLowered(c, 3, 'N', 5, 5)).toBe(false);
    expect(isEdgeLowered(c, 4, 'N', 5, 12)).toBe(false);
    expect(isEdgeLowered(NO_CUTAWAY, NO_BUILDING, 'N', 5, 6)).toBe(false);
  });

  it('lowers camera-facing walls of a neighbour right by the player (shared walls)', () => {
    // Front wall of a narrow row building owned by the next building (tile south of it).
    expect(isEdgeLowered(c, 4, 'N', 5, 6)).toBe(true);
    expect(isEdgeLowered(c, 4, 'N', 5, 5)).toBe(false);
    expect(isEdgeLowered(c, 4, 'W', 10, 5)).toBe(false);
    expect(isEdgeLowered(c, NO_BUILDING, 'N', 5, 6)).toBe(false);
  });

  it('hides only the current building roof', () => {
    expect(isRoofHidden(c, 3)).toBe(true);
    expect(isRoofHidden(c, 4)).toBe(false);
    expect(isRoofHidden(NO_CUTAWAY, NO_BUILDING)).toBe(false);
  });

  it('keys change with tile, side and building only', () => {
    expect(cutawayKey(NO_CUTAWAY)).toBe(cutawayKey({ ...NO_CUTAWAY, tx: 9 }));
    expect(cutawayKey(c)).not.toBe(cutawayKey({ ...c, tx: 6 }));
    expect(cutawayKey(c)).not.toBe(cutawayKey({ ...c, side: { sx: -1, sz: 1 } }));
  });
});

describe('occluders (camera–player line)', () => {
  // Camera toward +x +y (yaw 45°). A 2-storey block at x/y 4..9, a bungalow at -6..-2 (behind).
  const yaw = Math.PI / 4;
  const at = (x: number, y: number, z: number) => {
    if (x >= 4 && x <= 9 && y >= 4 && y <= 9 && z <= 1) return 7;
    if (x >= -6 && x <= -2 && y >= -6 && y <= -2 && z === 0) return 8;
    if (x >= 30 && x <= 33 && y >= 30 && y <= 33 && z === 0) return 9;
    return NO_BUILDING;
  };

  it('finds the building between the camera and the player, not the one behind or far away', () => {
    const occ = occludersOf(at, 0.5, 0.5, 0, yaw);
    expect([...occ]).toEqual([7]);
  });

  it('skips the player own building', () => {
    expect(occludersOf(at, 5.5, 5.5, 0, yaw, 7).size).toBe(0);
  });

  it('a camera on the other side sees past the block', () => {
    expect([...occludersOf(at, 0.5, 0.5, 0, yaw + Math.PI)]).toEqual([8]);
  });

  it('cuts occluders down to the player floor: walls lowered, roof and upper levels hidden', () => {
    const c: Cutaway = { ...NO_CUTAWAY, tx: 0, ty: 0, z: 0, occluders: new Set([7]) };
    expect(cutawayKey(c)).not.toBe('-');
    expect(isEdgeLowered(c, 7, 'N', 20, 20)).toBe(true);
    expect(isEdgeLowered(c, 8, 'N', 20, 20)).toBe(false);
    expect(isRoofHidden(c, 7)).toBe(true);
    expect(isLevelHidden(c, 7, 1)).toBe(true);
    expect(isLevelHidden(c, 7, 0)).toBe(false);
    expect(isLevelHidden(c, 8, 1)).toBe(false);
  });
});
