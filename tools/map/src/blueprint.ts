import {
  ContentIdSchema,
  EDGE_TYPES,
  I18nKeySchema,
  RoomTypeSchema,
  STAIR_DIRS,
  STAIR_MAX_LEN,
  TagSchema,
  TileRefSchema,
  ZoneNameSchema,
  ZoneRectSchema,
} from '@deadzone/content';
import { z } from 'zod';

const Int = z.number().int();
const Xy = z.tuple([Int, Int]);

/** Door or window cut into a generated wall; `at` is building-local, `side` of that tile. */
export const OpeningSchema = z.strictObject({
  at: Xy,
  side: z.enum(['n', 's', 'e', 'w']),
  type: z.enum(EDGE_TYPES).exclude(['wall', 'fence']),
  /** Default: the building's `door` / `window`. */
  contentId: TileRefSchema.optional(),
});

/** Edge left open: no wall at all (ruins, breaches); `at` is building-local. */
export const GapSchema = z.strictObject({ at: Xy, side: z.enum(['n', 's', 'e', 'w']) });

const RoomsSchema = z.record(
  z.string().length(1),
  z.strictObject({
    /** Map-global `roomId`. */
    id: Int.min(1).max(0xffff),
    type: RoomTypeSchema,
    floor: TileRefSchema,
  }),
);

/**
 * Upper floor (z >= 1) of a building (`building.floors[]`, contract with Physics / Simulation).
 * `plan` / `rooms` default to the ground floor's (room ids + ROOM_Z_STRIDE * z). Tiles of
 * flights from z − 1 have no floor (the stair opening). The roof sits on the top floor only.
 */
export const FloorSchema = z.strictObject({
  z: Int.min(1).max(15),
  plan: z.array(z.string().min(1)).min(1).optional(),
  rooms: RoomsSchema.optional(),
  openings: z.array(OpeningSchema).default([]),
  gaps: z.array(GapSchema).default([]),
});

export const BuildingSchema = z.strictObject({
  /** Map-global `buildingId` (the renderer hides roof and walls per building). */
  id: Int.min(1).max(0xffff),
  /** World tile of `plan[0][0]`. */
  origin: Xy,
  /**
   * ASCII floor plan, one string per row. Each character is a key of `rooms`; `.` and space are
   * outside. Walls are generated on every border between different rooms or room and outside.
   */
  plan: z.array(z.string().min(1)).min(1),
  rooms: RoomsSchema,
  wall: TileRefSchema,
  window: TileRefSchema.optional(),
  door: TileRefSchema.optional(),
  /** Roof over every room tile; omit for no roof. */
  roof: TileRefSchema.optional(),
  openings: z.array(OpeningSchema).default([]),
  /** Wall edges removed after openings (ruins). */
  gaps: z.array(GapSchema).default([]),
  /** `false`: no generated walls (canopy, carport): rooms, floor and roof only. */
  walls: z.boolean().default(true),
  /** Upper floors (z = 1, 2, ...); empty = single-storey. */
  floors: z.array(FloorSchema).default([]),
  /**
   * Building kind for the sim (`buildingKinds` of its chunks, `building-kind.ts`); omitted = from
   * the room types (`kindFromRooms`).
   */
  kind: z
    .string()
    .regex(/^[a-z]+(-[a-z]+)*$/)
    .optional(),
});

/** Named map zone (manifest `zones`): explicit world-tile rects plus tiles from `zonePlans`. */
export const BlueprintZoneSchema = z.strictObject({
  id: ZoneNameSchema,
  role: ZoneNameSchema,
  z: Int.default(0),
  /** `[x, x + w) × [y, y + h)` in world tiles. */
  rects: z.array(ZoneRectSchema).default([]),
  tags: z.array(TagSchema).optional(),
});

/**
 * ASCII zone layer: each character maps (via `legend`) to a zone id from `zones`; `.` and space
 * are no zone. Tiles are merged into as few rects as possible and added to that zone.
 */
export const ZonePlanSchema = z.strictObject({
  /** World tile of `plan[0][0]`. */
  origin: Xy,
  plan: z.array(z.string().min(1)).min(1),
  legend: z.record(z.string().length(1), ZoneNameSchema),
});

/**
 * Stairs tool: a flight from level `zFrom` (default 0) to `zFrom + 1`. `at` is the bottom tile
 * (world tiles), the flight climbs `len` tiles in `dir` (N = −y, E = +x, S = +y, W = −x). Saved
 * in the chunk of `at` on level `zFrom`; its tiles have no floor on `zFrom + 1`.
 */
export const BlueprintStairsSchema = z.strictObject({
  at: Xy,
  dir: z.enum(STAIR_DIRS),
  len: Int.min(1).max(STAIR_MAX_LEN),
  zFrom: Int.min(0).max(14).default(0),
});

/**
 * Human-editable authoring source of a map (`tools/map/blueprints/*.json`). All coordinates are
 * world tiles (+x east, +y south); later entries paint over earlier ones.
 */
export const BlueprintSchema = z.strictObject({
  /** Map folder = `<pack>/maps/<id>/`. */
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id: kebab-case'),
  name: I18nKeySchema.optional(),
  floorHeight: z.number().positive().default(3),
  /** Inclusive chunk range on level 0 (32×32 tiles per chunk). */
  chunks: z.strictObject({ cx0: Int, cy0: Int, cx1: Int, cy1: Int }),
  /** Floor everywhere before areas and buildings. */
  ground: TileRefSchema,
  /** Floor rectangles: roads, lots, paths. */
  areas: z
    .array(z.strictObject({ x: Int, y: Int, w: Int.min(1), h: Int.min(1), floor: TileRefSchema }))
    .default([]),
  buildings: z.array(BuildingSchema).default([]),
  /**
   * Free-standing fence runs (after buildings): `len` edges from tile (x, y), along +x for side
   * `n` (north edges of that row), along +y for side `w` (west edges of that column).
   */
  fences: z
    .array(
      z.strictObject({
        x: Int,
        y: Int,
        side: z.enum(['n', 'w']),
        len: Int.min(1),
        contentId: TileRefSchema,
      }),
    )
    .default([]),
  /** Map objects in world tiles (furniture, containers, lights). */
  objects: z
    .array(
      z.strictObject({
        contentId: ContentIdSchema,
        x: Int,
        y: Int,
        /** Level (0 = ground); upper floors need that level painted by a building. */
        z: Int.min(0).max(15).default(0),
        rot: Int.min(0).max(3).default(0),
        offset: z
          .strictObject({ x: z.number().min(-0.5).max(0.5), y: z.number().min(-0.5).max(0.5) })
          .optional(),
      }),
    )
    .default([]),
  /** Flights of stairs (level `zFrom` → `zFrom + 1`). */
  stairs: z.array(BlueprintStairsSchema).default([]),
  zones: z.array(BlueprintZoneSchema).default([]),
  zonePlans: z.array(ZonePlanSchema).default([]),
});

export type Blueprint = z.output<typeof BlueprintSchema>;
export type BlueprintInput = z.input<typeof BlueprintSchema>;
export type Building = z.output<typeof BuildingSchema>;
export type BlueprintStairs = z.output<typeof BlueprintStairsSchema>;

/** Parses a blueprint; throws with readable zod issues. */
export function parseBlueprint(input: unknown): Blueprint {
  const r = BlueprintSchema.safeParse(input);
  if (!r.success) throw new Error(`blueprint: ${z.prettifyError(r.error)}`);
  return r.data;
}
