import type { VehicleImpactTarget, VehiclePart } from './vehicles.js';
import type { BodyPart, ContainerId, ItemId, PlayerId, WoundKind } from './commands.js';
import type { EdgeSide, OpeningState } from './map.js';
import type {
  CharacterProfileView,
  ContainerKind,
  MapMarkerView,
  OpeningEdgeKind,
  ReloadKind,
} from './views.js';

export type CommandRejectReason =
  /** Failed the zod schema (structural validation). */
  | 'invalid'
  /** `seq` not greater than the last accepted one for this player. */
  | 'stale-seq'
  /** `tick` further in the future than the command window. */
  | 'too-far-in-future'
  /** No such player in the world when the command was applied (gameplay validation). */
  | 'unknown-player'
  /** The player is dead. */
  | 'dead'
  /** Debug command while the sim is not in dev mode. */
  | 'dev-only'
  /** Not possible in the current state (e.g. sleep while not tired, survival disabled). */
  | 'invalid-state'
  /** Nothing to act on (e.g. bandage on a part without wounds). */
  | 'invalid-target'
  /** `itemId` is not a known item usable for this command. */
  | 'unknown-item'
  /** No such item / container, or not usable this way (e.g. eating a hammer). */
  | 'no-item'
  /** Firearm empty / nothing to load (`attack`, `reload`, `loadMagazine`). */
  | 'no-ammo'
  /** The door is locked (`toggleDoor` without `lock`). */
  | 'locked'
  /** Target container or item is not within reach (1.5 tiles) of the player. */
  | 'out-of-range'
  /** Does not fit: container capacity, bag tags, or the carry hard limit. */
  | 'no-space'
  /** Needs a tool the player does not carry (e.g. a can opener, `food.openWith`). */
  | 'missing-tool'
  /** The action queue is full. */
  | 'busy'
  /** Crafting: the recipe must be learned first (`requiresLearning`). */
  | 'not-learned'
  /** Crafting: a required skill level is not reached. */
  | 'skill-too-low'
  /** Crafting: no station of the recipe nearby, or its level is below `station.minLevel`. */
  | 'no-station'
  /** Crafting: parts missing (inventory + containers within the crafting radius). */
  | 'missing-parts'
  /** `newCharacter`: invalid choice or over budget (`commandRejected.detail` says what). */
  | 'invalid-character'
  /** `watchTv` / VHS: no TV within `leisure.tvRadiusTiles` (`no-station`) or it has no power. */
  | 'no-power'
  /** `addMarker`: the character already has `worldSettings.mapMarkers.maxMarkers` markers. */
  | 'marker-limit'
  /** `editMarker` / `removeMarker`: no marker with this id. */
  | 'unknown-marker';

/**
 * Why a chunk changed for the client: `opening` = a door / window / fence changed state or took
 * damage, `object` = storage placed on or picked up from the ground (furniture-like), `loot` =
 * items on the ground appeared, changed or disappeared (drop, pick-up, throw, spot search).
 */
export type ChunkChangeReason = 'opening' | 'object' | 'loot';
export const CHUNK_CHANGE_REASONS: readonly ChunkChangeReason[] = ['opening', 'object', 'loot'];

export type DeathCause =
  | 'bleeding'
  | 'starvation'
  | 'dehydration'
  | 'infection'
  | 'temperature'
  | 'wounds'
  | 'debug'
  /** Killed by zombie attacks (health reached 0 in combat). */
  | 'zombie'
  /** Fall from height (physics). */
  | 'fall';

/**
 * What caused a `hit`: a player's melee swing, a shove, a zombie attack, a shot, or a car
 * (`vehicle`: a zombie killed by ramming / running over; `attacker` = the driver).
 */
export type HitSource = 'melee' | 'shove' | 'zombie' | 'shot' | 'vehicle';

/** Timed actions (docs/sim-architecture.md, `actions`). */
export type ActionKind =
  | 'search'
  | 'eat'
  | 'drink'
  | 'bandage'
  | 'unpack'
  | 'craft'
  | 'read'
  /** TV session (`watchTv`) or a VHS tape (`useItem` on a `vhs` / `watchTv {vhs}`). */
  | 'watch'
  /** Openings (`openings/timed.ts`): smash a window (`smashWindow`, also `breakWindow`). */
  | 'smashWindow'
  /** Climb through an open / broken window (`climbThrough`; the physics `vault` state). */
  | 'climbThrough'
  /** Clear the shards from a broken window frame (`removeGlass`). */
  | 'removeGlass'
  /** Nail one plank over a door / window / gate (`barricade`). */
  | 'barricade'
  /** Pull the top plank off (`removeBarricade`). */
  | 'removeBarricade'
  /** Force a locked door / gate: crowbar or kick (`forceDoor`). */
  | 'forceDoor';

export type ActionInterruptReason =
  /** Movement intent while the action runs. */
  | 'moved'
  /** The player attacked or shoved (melee swing, shot, shove). */
  | 'attack'
  | 'cancelled'
  /** Zombies nearby (hook, never until Stage 4). */
  | 'threat'
  | 'asleep'
  | 'died'
  /** The item or container is gone or out of reach when the action should complete. */
  | 'target-lost';

export type WakeReason =
  'command' | 'rested' | 'max-duration' | 'died' | 'noise' | 'zombie' | 'pain' | 'fever';

/** Leisure activity of `leisureCompleted`. */
export type LeisureActivity = 'read' | 'tv' | 'vhs';

export type LurePhase = 'idle' | 'armed' | 'sounding' | 'running' | 'spent' | 'removed';

/** What made a noise (`noise` event, debug circles). */
export const NOISE_SOURCES = [
  'footstep',
  'action',
  'break',
  'attack',
  'shot',
  'impact',
  'lure',
  'debug',
  /** An animal call while fleeing (a dog barking, `animalType.fleeNoise`). Last: indices are hashed. */
  'animal',
  /** A running engine (louder with throttle); after `animal`, indices are hashed. */
  'vehicle',
] as const;
export type NoiseSource = (typeof NOISE_SOURCES)[number];

/**
 * Why an animal started to flee: saw a player within `fleeDistanceTiles`, saw a zombie, heard a
 * noise (footsteps, shots…; sneaking is quieter and less visible) or was hit.
 */
export type AnimalFleeReason = 'player' | 'zombie' | 'noise' | 'hit';

/** Why a zombie became alert: heard a noise (investigates) or saw a player (chases). */
export type ZombieAlertReason = 'noise' | 'sight';

/**
 * Body events of the physics module (`physics` SimEvent): attack / shove started, hit taken
 * (`source` = attacker), staggered, knocked down, back on the feet after getting up, died.
 */
export const PHYS_EVENT_KINDS = [
  'attackStart',
  'hitLanded',
  'staggered',
  'fellDown',
  'gotUp',
  'died',
  /** Left a floor over a drop (knocked back over an edge / into a hole): state `fall`. */
  'startedFalling',
  /** Hit the ground after a fall (see `fellFromHeight` for levels and damage). */
  'landed',
  /** Landed on the far side of a fence / window after `vault` (state back to `idle`). */
  'vaulted',
  /** Tripped while vaulting: lies on the far side (`knockdown`, then `getup`). */
  'tripped',
] as const;
export type PhysEventKind = (typeof PHYS_EVENT_KINDS)[number];

/** Events emitted by the sim for the host (sounds, UI, debug). Never a source of truth. */
export type SimEvent =
  | {
      type: 'commandRejected';
      tick: number;
      playerId: PlayerId;
      seq: number;
      reason: CommandRejectReason;
      /** Extra info, e.g. `newCharacter`: `over-budget:-3`, `trait-conflict:base:weak`. */
      detail?: string;
    }
  /**
   * Physics body event (players and zombies): `entity` = StableId, `source` = attacker StableId
   * for `hitLanded`. Same tick as the matching snapshot `state` change.
   */
  | { type: 'physics'; tick: number; kind: PhysEventKind; entity: number; source?: number }
  /**
   * Landing after a fall: `levels` dropped (× floor height 3 m), `damage` dealt (player health
   * or zombie hp; 0 = unhurt). Same tick as the physics `landed` event.
   */
  | {
      type: 'fellFromHeight';
      tick: number;
      entity: number;
      levels: number;
      damage: number;
      killed: boolean;
    }
  /**
   * A vehicle hit something (`vehicleId` = StableId): `energy` = kinetic energy lost in the hit
   * (J, ½·m·Δv² along the normal), `target` = StableId of a body or vehicle (0 for walls and
   * fences), (x, y) = contact point in tiles, (nx, ny) = unit normal pointing away from the
   * obstacle (into the car).
   */
  | {
      type: 'vehicleImpact';
      tick: number;
      vehicleId: number;
      energy: number;
      /** Closing speed at the contact (m/s, ≥ 0). */
      speed: number;
      targetKind: VehicleImpactTarget;
      target: number;
      x: number;
      y: number;
      nx: number;
      ny: number;
    }
  /** A player got into (`vehicleEnter`) or out of (`vehicleExit`) seat `seat` of a vehicle. */
  | {
      type: 'vehicleEnter';
      tick: number;
      vehicleId: number;
      playerId: PlayerId;
      entity: number;
      seat: number;
    }
  | {
      type: 'vehicleExit';
      tick: number;
      vehicleId: number;
      playerId: PlayerId;
      entity: number;
      seat: number;
      /**
       * `exit` = got out (`exitVehicle`); `pulled` = a zombie pulled them out through a broken
       * window (v16: forced out on that side and knocked down next to the car).
       */
      reason: 'exit' | 'pulled';
    }
  /**
   * A vehicle part reached 0 hp (`part`: a window shattered, a tyre went flat, the engine
   * died, a body zone is wrecked). (x, y) = the hit point in tiles. A broken window is the hook
   * for zombies reaching into the cabin later.
   */
  | {
      type: 'vehiclePartBroken';
      tick: number;
      vehicleId: number;
      part: VehiclePart;
      x: number;
      y: number;
    }
  /** The engine started (a driver got in with fuel) or stopped (`reason`). */
  | { type: 'engineStart'; tick: number; vehicleId: number }
  | {
      type: 'engineStop';
      tick: number;
      vehicleId: number;
      reason: 'driver-left' | 'no-fuel' | 'broken';
    }
  /** The player's character was created (`newCharacter`). */
  | { type: 'characterCreated'; tick: number; playerId: PlayerId; character: CharacterProfileView }
  /** Player death (permadeath): the death screen reads `day` / `minuteOfDay` from here. */
  | {
      type: 'died';
      tick: number;
      playerId: PlayerId;
      cause: DeathCause;
      day: number;
      minuteOfDay: number;
      /** Full game days since the start of the game (death screen: "survived N days"). Always set by the sim. */
      daysSurvived?: number;
      /** Always set by the sim. */
      zombiesKilled?: number;
    }
  /**
   * A hit landed. `attacker` / `target` are StableIds (player, zombie or animal); `damage` in HP
   * (zombie / animal HP or player health 0–100), 0 for shoves; `killed` = the target died of it.
   */
  | {
      type: 'hit';
      tick: number;
      source: HitSource;
      attacker: number;
      target: number;
      damage: number;
      x: number;
      y: number;
      killed: boolean;
    }
  /** A zombie died; `playerId` = the killer. */
  /** `playerId` −1: no killer (the zombie died from a fall). */
  | { type: 'zombieKilled'; tick: number; zombie: number; playerId: PlayerId; x: number; y: number }
  /**
   * Animals (sim `animals/*`, snapshot kind `animal`). `animal` = StableId, `animalType` = content
   * id. `animalSpawned`: new animal (map population, init list, `debugSpawnAnimal`).
   */
  | {
      type: 'animalSpawned';
      tick: number;
      animal: number;
      animalType: string;
      x: number;
      y: number;
      z: number;
    }
  /**
   * The animal started to flee (snapshot anim `flee`) from (fromX, fromY). `noise` = it made its
   * flee call (`fleeNoise`, e.g. a dog barking: zombies hear it, source `animal`).
   */
  | {
      type: 'animalFled';
      tick: number;
      animal: number;
      animalType: string;
      reason: AnimalFleeReason;
      x: number;
      y: number;
      fromX: number;
      fromY: number;
      noise: boolean;
    }
  /**
   * The animal was killed (`hit` events carry the damage; the corpse stays in the snapshot with
   * anim `dead`). Loot (`animalType.loot`) lies in ground pile `container` (0 = no loot), pick it
   * up with `pickUp` / `takeItem` / `takeAll`.
   */
  | {
      type: 'animalKilled';
      tick: number;
      animal: number;
      animalType: string;
      playerId: PlayerId;
      x: number;
      y: number;
      z: number;
      container: ContainerId;
      loot: { def: string; count: number }[];
    }
  /** A bird flew off and left the world (gone from the snapshot from this tick). */
  | { type: 'animalDespawned'; tick: number; animal: number; animalType: string; reason: 'fled' }
  /** A melee weapon broke (condition reached 0) and was removed or replaced by `brokenInto`. */
  | { type: 'weaponBroke'; tick: number; playerId: PlayerId; itemId: string }
  | { type: 'wounded'; tick: number; playerId: PlayerId; part: BodyPart; wound: WoundKind }
  /** Dev builds only (`init.dev`): every noise of the tick, for debug circles. */
  | {
      type: 'noise';
      tick: number;
      x: number;
      y: number;
      z: number;
      radiusTiles: number;
      volume: number;
      source: NoiseSource;
    }
  /**
   * A zombie (StableId) started investigating a noise or chasing a player (growl sound, HUD).
   * Not emitted again while it stays in that state.
   */
  | {
      type: 'zombieAlerted';
      tick: number;
      zombie: number;
      reason: ZombieAlertReason;
      x: number;
      y: number;
    }
  | { type: 'fellAsleep'; tick: number; playerId: PlayerId }
  /**
   * A lure changed phase: `armed` (timer running until `untilTick`), `sounding` (noise until
   * `untilTick`), `running` (runner moving towards (toX, toY), noise until `untilTick`),
   * `idle` (placed, waiting for the remote), `spent` (used up, item gone) or `removed`
   * (picked up).
   */
  /** A `craft` action finished: parts consumed, results added (inventory or `container`). */
  | {
      type: 'crafted';
      tick: number;
      playerId: PlayerId;
      recipe: string;
      results: { def: string; count: number }[];
      /** Results that went to a ground pile (heavy stations, full inventory). */
      container?: ContainerId;
    }
  | { type: 'skillLevelUp'; tick: number; playerId: PlayerId; skill: string; level: number }
  /** Recipe learned (literature `unlocksRecipes`, profession, dev). */
  | { type: 'recipeLearned'; tick: number; playerId: PlayerId; recipe: string }
  | {
      type: 'lureChanged';
      tick: number;
      item: ItemId;
      def: string;
      phase: LurePhase;
      x: number;
      y: number;
      z: number;
      untilTick?: number;
      toX?: number;
      toY?: number;
    }
  /**
   * A firearm shot: one ray per projectile from (x, y) to its end (first zombie hit, a wall or
   * the range); `hit` = StableId of the zombie hit, 0 = miss. Damage comes as `hit` events
   * (`source: 'shot'`). `ammo` = rounds left.
   */
  | {
      type: 'shot';
      tick: number;
      playerId: PlayerId;
      weapon: string;
      x: number;
      y: number;
      rays: { toX: number; toY: number; hit: number }[];
      ammo: number;
      jammed: boolean;
    }
  /**
   * Reload / magazine loading started (`untilTick`) or finished (`done`, `ammo` loaded).
   * Single-round loading (`kind: 'single'`): `started` (untilTick = end of the first round), one
   * `round` per loaded round (`ammo` = rounds in the gun now, `untilTick` = end of the next round,
   * 0 on the last), then `done`; `attack` interrupts it → `cancelled` (rounds loaded so far stay).
   */
  | {
      type: 'reload';
      tick: number;
      playerId: PlayerId;
      item: ItemId;
      def: string;
      phase: 'started' | 'round' | 'done' | 'cancelled';
      untilTick: number;
      ammo: number;
      kind: ReloadKind;
    }
  /** A thrown item landed at (x, y). */
  | {
      type: 'thrown';
      tick: number;
      playerId: PlayerId;
      item: ItemId;
      def: string;
      fromX: number;
      fromY: number;
      x: number;
      y: number;
      z: number;
      broke: boolean;
    }
  /**
   * A door / window / fence edge changed state or took damage (renderer: door sprite, broken
   * glass, planks, a knocked-over fence = `fence` + `broken`). `by`: a player's command, a zombie
   * bashing it, crowd pressure (`crowd`) or a dev command.
   */
  | {
      type: 'openingChanged';
      tick: number;
      tx: number;
      ty: number;
      z: number;
      side: EdgeSide;
      kind: OpeningEdgeKind;
      state: OpeningState;
      /** Hit points left: edge + planks (0..maxHp, as `OpeningView`). */
      hp: number;
      maxHp: number;
      /** Planks over the edge (0..4): each `barricade` / `removeBarricade` / plank knocked off. */
      barricade: number;
      /** Window: glass in the frame (false after `removeGlass`). */
      glass: boolean;
      by: 'player' | 'zombie' | 'crowd' | 'debug' | 'vehicle';
    }
  /**
   * The character's map markers changed (`addMarker` / `editMarker` / `removeMarker`, also in
   * pause): full list (at most `maxMarkers`). `changed` = id added / edited / removed.
   */
  | {
      type: 'markersChanged';
      tick: number;
      playerId: PlayerId;
      change: 'added' | 'edited' | 'removed';
      changed: number;
      markers: MapMarkerView[];
    }
  /**
   * Chunks newly discovered by the player (fog of war; checked every
   * `worldSettings.playerMap.discoverEverySec` within the current sight range). Increments only:
   * the full bitmap is in `SimViewPatch.worldMap.discovered`.
   */
  | {
      type: 'chunksDiscovered';
      tick: number;
      playerId: PlayerId;
      cells: [number, number][];
    }
  /**
   * Visible state of chunk (cx, cy) on level z changed (docs/sim-architecture.md 9.24): the
   * client streamer rebuilds that chunk (`streamer.invalidate`). At most one event per chunk,
   * level and reason per tick, emitted at the end of the tick in (z, cy, cx, reason) order. Not
   * emitted for chunks the LOD just loaded or released (their generated state).
   */
  | {
      type: 'chunkChanged';
      tick: number;
      cx: number;
      cy: number;
      z: number;
      reason: ChunkChangeReason;
    }
  /**
   * A window broke (glass shatters, loud `break` noise): a player's `smashWindow` (`playerId`,
   * `withHand` = bare hands, may cut the hand), a zombie bashing it or crowd pressure.
   */
  | {
      type: 'windowSmashed';
      tick: number;
      tx: number;
      ty: number;
      z: number;
      side: EdgeSide;
      by: 'player' | 'zombie' | 'crowd' | 'vehicle';
      playerId?: PlayerId;
      withHand?: boolean;
    }
  /**
   * `forceDoor` finished: `success` = the locked door / gate gave way (state `broken`);
   * otherwise it only took damage (`openingChanged`). `method`: crowbar (`pry`) or `kick`.
   */
  | {
      type: 'doorForced';
      tick: number;
      playerId: PlayerId;
      tx: number;
      ty: number;
      z: number;
      side: EdgeSide;
      method: 'pry' | 'kick';
      success: boolean;
    }
  /**
   * Crowd pressure on a closed door / window / fence changed level (sim `physics/crowd.ts`,
   * checked every 0.5 s): 0 = none (a lone zombie only bangs), 1..3 = the edge shakes harder.
   * `units` = net pressure in zombie units (pressing zombies by mass − player holding −
   * barricade), `pushers` = zombies counted. Client: shake / creak animation and sound.
   */
  | {
      type: 'openingPressure';
      tick: number;
      tx: number;
      ty: number;
      z: number;
      side: EdgeSide;
      kind: OpeningEdgeKind;
      level: number;
      units: number;
      pushers: number;
    }
  /**
   * Uninterrupted sleep long enough (`sleep.saveAfterRealSec`, 2 real minutes at ×1): the host
   * saves the game now (the worker posts `saved` with reason `sleep`).
   */
  | {
      type: 'sleepSaved';
      tick: number;
      playerId: PlayerId;
      fatigueRecovered: number;
      /** Real seconds of uninterrupted sleep (≥ `sleep.saveAfterRealSec`); always set by the sim. */
      realSec?: number;
    }
  /**
   * Sleep ended. `restGained` = fatigue recovered by this sleep (partial when interrupted),
   * `restCap` = the place's limit per sleep (`sleep.surfaces.*.maxRecoveryPerSleep`), `saved` =
   * whether `sleepSaved` was emitted during this sleep. The sim always sets the three fields.
   */
  | {
      type: 'wokeUp';
      tick: number;
      playerId: PlayerId;
      reason: WakeReason;
      restGained?: number;
      restCap?: number;
      saved?: boolean;
    }
  /**
   * A leisure session finished (`read`, TV, VHS): fatigue rested and boredom / stress removed
   * (points, actually applied).
   */
  | {
      type: 'leisureCompleted';
      tick: number;
      playerId: PlayerId;
      activity: LeisureActivity;
      fatigue: number;
      boredom: number;
      stress: number;
    }
  /**
   * A VHS tape was watched to the end. `xp` = XP granted per skill (empty when this character
   * has already watched it and the tape is `oncePerCharacter`: `repeat` true).
   */
  | {
      type: 'vhsWatched';
      tick: number;
      playerId: PlayerId;
      vhs: string;
      xp: { skill: string; xp: number }[];
      repeat: boolean;
    }
  /** Moodle level change (0 = hidden). Sound / toast hook; the HUD uses the `view` message. */
  | {
      type: 'moodleChanged';
      tick: number;
      playerId: PlayerId;
      moodle: string;
      from: number;
      to: number;
    }
  /** Suggested game speed (sleep: `sleep.timeScaleHint`, waking: 1). The host decides. */
  | { type: 'timeScaleHint'; tick: number; speed: 1 | 2 | 4 }
  | { type: 'dayPassed'; tick: number; day: number }
  | {
      type: 'actionStarted';
      tick: number;
      playerId: PlayerId;
      action: ActionKind;
      endTick: number;
      item?: ItemId;
      container?: ContainerId;
    }
  | { type: 'actionCompleted'; tick: number; playerId: PlayerId; action: ActionKind }
  | {
      type: 'actionInterrupted';
      tick: number;
      playerId: PlayerId;
      action: ActionKind;
      reason: ActionInterruptReason;
    }
  /** Loot panel opened (`firstSearch` = this search generated the loot). */
  | {
      type: 'containerOpened';
      tick: number;
      playerId: PlayerId;
      container: ContainerId;
      firstSearch: boolean;
    }
  /**
   * Items came into the player's inventory (`pickUp`, `takeItem`, `takeAll` = one event per
   * stack, `moveItem` / `equip` from outside). `itemId` = instance now holding them, `defId` =
   * content id, `count` = pieces moved, `source` = kind of the container they came from
   * (`ground`, `world` storage, `corpse`, a `bag` lying there), `container` = its id. Log:
   * "+ Bandaż".
   */
  | {
      type: 'itemPicked';
      tick: number;
      playerId: PlayerId;
      itemId: ItemId;
      defId: string;
      count: number;
      source: ContainerKind;
      container: ContainerId;
    }
  /**
   * Items left the player's inventory (`drop`, `putItem`, `moveItem` / `placeStorage` to the
   * outside). `target` = kind of the receiving container, `container` = its id. Log:
   * "- Puszka fasoli".
   */
  | {
      type: 'itemDropped';
      tick: number;
      playerId: PlayerId;
      itemId: ItemId;
      defId: string;
      count: number;
      target: ContainerKind;
      container: ContainerId;
    }
  /**
   * A spot search (`search {x, y}`) finished: hidden items found within
   * `search.spotRadiusTiles` (now normal ground piles, `container` = pile id); empty = nothing.
   */
  | {
      type: 'spotSearched';
      tick: number;
      playerId: PlayerId;
      x: number;
      y: number;
      z: number;
      found: { itemId: ItemId; defId: string; count: number; container: ContainerId }[];
    }
  /** Ate / drank / used an item (content id), e.g. for sounds and toasts. */
  | {
      type: 'itemUsed';
      tick: number;
      playerId: PlayerId;
      action: ActionKind;
      itemId: string;
      freshness?: Freshness;
    };

/** Food and drink state from `spoilage.freshMin` / `rottenMin` (lazy, per game minute). */
export type Freshness = 'fresh' | 'stale' | 'rotten';
