import type { RoomIntelState, RoomIntelView, WorldMapView } from '@deadzone/protocol';
import { entityCount, readEntity } from '../sim/snapshot.js';
import { roomKey, type BuildingPlan, type PlanRoom, type RoomKey } from './building-plan.js';

/**
 * What the player knows about building interiors (deadzone-hud-v2-spec „Piętra (UI)”): room
 * discovery per floor, zombies seen with their floor, and the floor of each map marker.
 *
 * `SimFloorIntel` reads it from the sim (protocol 22); `DemoFloorIntel` (`?floorsDemo=1`) is
 * fixed review data for screenshots.
 */
export type RoomState = 'unknown' | 'seen' | 'searched';

/** A zombie the player saw or heard, with its level (live minimap and „ostatnio widziane”). */
export interface SeenZombie {
  x: number;
  y: number;
  z: number;
  /** Sim tick of the sighting; equal to the current tick while it is sensed now. */
  tick: number;
}

export interface FloorIntel {
  /** Bumps on every change (cheap redraw check). */
  readonly version: number;
  room(room: Pick<PlanRoom, 'key' | 'parts'>, z: number): RoomState;
  /** Zombies sensed right now (minimap), with their level. */
  sensedZombies(): readonly SeenZombie[];
  /** Last sightings (big map plan), newest per zombie. */
  lastSeenZombies(): readonly SeenZombie[];
  /** Level of map marker `id`; undefined = unknown (shown on the ground floor). */
  markerZ(id: number): number | undefined;
}

/** The part of a sim view patch the floor intel reads (protocol 22). */
export interface FloorIntelPatch {
  worldMap?: Pick<WorldMapView, 'rooms' | 'roomsAdd' | 'zombieSightings'> | undefined;
  sensedZombies?: readonly number[] | undefined;
}

/** Floor of a body height `z` (same rounding as the player's level). */
const floorOf = (z: number): number => Math.floor(z + 1e-3);

/**
 * Floor intel from the sim (protocol 22, docs/floors-ui.md, docs/sim-architecture.md 9.42):
 * - `worldMap.rooms` (full list) / `roomsAdd` (changes): seen / searched per chunk piece of a
 *   room (`RoomIntelView {cx, cy, z, room, state}`);
 * - `sensedZombies` (stableIds seen or heard now): positions and level from the snapshot
 *   entities (`applySnapshot`);
 * - `worldMap.zombieSightings`: last observation per zombie, newest first;
 * - marker levels come from the markers themselves (`MapMarkerView.z`).
 */
export class SimFloorIntel implements FloorIntel {
  version = 0;
  private readonly rooms = new Map<RoomKey, RoomIntelState>();
  private sightings: SeenZombie[] = [];
  private sensedIds = new Set<number>();
  private sensed: SeenZombie[] = [];

  constructor(
    /** Level of marker `id` (the sim's `MapMarkerView.z`); undefined = unknown marker. */
    private readonly markerFloor: (id: number) => number | undefined = () => undefined,
  ) {}

  /** `SimViewPatch` (missing fields = unchanged). */
  applyView(v: FloorIntelPatch): void {
    const w = v.worldMap;
    if (w?.rooms) {
      this.rooms.clear();
      this.addRooms(w.rooms);
      this.version++;
    }
    if (w?.roomsAdd?.length) {
      this.addRooms(w.roomsAdd);
      this.version++;
    }
    if (w?.zombieSightings) {
      this.sightings = w.zombieSightings.map((z) => ({ x: z.x, y: z.y, z: z.z, tick: z.tick }));
      this.version++;
    }
    if (v.sensedZombies) {
      this.sensedIds = new Set(v.sensedZombies);
      if (!this.sensedIds.size && this.sensed.length) {
        this.sensed = [];
        this.version++;
      }
    }
  }

  /** Snapshot entity buffer: positions of the sensed zombies (no-op when none is sensed). */
  applySnapshot(buf: Float32Array, tick: number): void {
    if (!this.sensedIds.size) return;
    const next: SeenZombie[] = [];
    const n = entityCount(buf);
    for (let i = 0; i < n; i++) {
      const e = readEntity(buf, i);
      if (e && this.sensedIds.has(e.id)) next.push({ x: e.x, y: e.y, z: floorOf(e.z), tick });
    }
    this.sensed = next;
    this.version++;
  }

  /**
   * A room spanning chunks is one entry per chunk piece: `searched` once some piece is searched
   * and none is only seen, `seen` once any piece is known.
   */
  room(room: Pick<PlanRoom, 'key' | 'parts'>, z: number): RoomState {
    let searched = false;
    let seen = false;
    for (const p of room.parts) {
      const s = this.rooms.get(roomKey(z, p.cx, p.cy, p.room));
      if (s === 'searched') searched = true;
      else if (s === 'seen') seen = true;
    }
    return searched && !seen ? 'searched' : searched || seen ? 'seen' : 'unknown';
  }

  sensedZombies(): readonly SeenZombie[] {
    return this.sensed;
  }

  lastSeenZombies(): readonly SeenZombie[] {
    return this.sightings;
  }

  markerZ(id: number): number | undefined {
    return this.markerFloor(id);
  }

  private addRooms(list: readonly RoomIntelView[]): void {
    for (const r of list) this.rooms.set(roomKey(r.z, r.cx, r.cy, r.room), r.state);
  }
}

/**
 * Screenshot / review data (`?floorsDemo=1`): the building around the player half explored
 * (rooms near the stairs searched, the next ones seen, the rest unknown), zombies on the
 * player's floor and one floor above / below. Never used in normal play.
 */
export class DemoFloorIntel implements FloorIntel {
  version = 1;
  private states = new Map<RoomKey, RoomState>();
  private zombies: SeenZombie[] = [];
  private markers = new Map<number, number>();
  /** Markers without an explicit level: the demo player's floor. */
  private markerFloor = 0;

  /** Fills the demo state for `plan` around the player (once per building). */
  setup(plan: BuildingPlan, player: { x: number; y: number; z: number }, tick: number): void {
    this.states = new Map();
    for (const [z, f] of plan.floors) {
      const near = [...f.rooms].sort(
        (a, b) =>
          Math.hypot(a.label.x - player.x, a.label.y - player.y) -
          Math.hypot(b.label.x - player.x, b.label.y - player.y),
      );
      const dz = Math.abs(z - player.z);
      const searched = dz === 0 ? 4 : dz === 1 ? 2 : 0;
      const seen = dz === 0 ? 11 : dz === 1 ? 5 : 0;
      near.forEach((r, i) =>
        this.states.set(
          r.key,
          i < searched ? 'searched' : i < searched + seen ? 'seen' : 'unknown',
        ),
      );
    }
    const pick = (z: number, n: number): SeenZombie[] => {
      const f = plan.floors.get(z);
      if (!f) return [];
      // Rooms away from the player (not the hall / stairwell they stand in).
      const rooms = [...f.rooms]
        .filter((r) => r.type !== 'base:room-hall')
        .sort(
          (a, b) =>
            Math.abs(Math.hypot(a.label.x - player.x, a.label.y - player.y) - 6) -
            Math.abs(Math.hypot(b.label.x - player.x, b.label.y - player.y) - 6),
        )
        .slice(0, n);
      return rooms.map((r, i) => ({
        x: r.label.x + (i % 2 ? 0.6 : -0.6),
        y: r.label.y + 0.4,
        z,
        tick: tick - 20 * 60 * 3,
      }));
    };
    this.zombies = [...pick(player.z, 2), ...pick(player.z + 1, 1), ...pick(player.z - 1, 1)];
    this.markerFloor = player.z;
    this.version++;
  }

  setMarkerZ(id: number, z: number): void {
    this.markers.set(id, z);
    this.version++;
  }

  room(room: Pick<PlanRoom, 'key'>): RoomState {
    return this.states.get(room.key) ?? 'unknown';
  }

  sensedZombies(): readonly SeenZombie[] {
    return this.zombies;
  }

  lastSeenZombies(): readonly SeenZombie[] {
    return this.zombies;
  }

  markerZ(id: number): number | undefined {
    return this.markers.get(id) ?? this.markerFloor;
  }
}
