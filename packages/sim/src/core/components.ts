/**
 * Components as SoA typed arrays (bitecs 0.4 accepts any object as a component). They are created
 * per world, so several sims (tests, replays, server rooms) never share storage.
 * Every write to a float field goes through `Math.fround` (the arrays are Float32Array anyway,
 * fround is used on intermediate values so reads of just-computed values match stored ones).
 */
export function createComponents(capacity: number) {
  const f32 = () => new Float32Array(capacity);
  return {
    /** Monotonic u32, never reused, persisted in saves. Defines iteration order. */
    StableId: { value: new Uint32Array(capacity) },
    /** Tiles (+x east, +y south); z = floor level. */
    Position: { x: f32(), y: f32(), z: f32() },
    /** Displacement requested this tick in tiles per tick (before collisions). */
    Velocity: { x: f32(), y: f32() },
    /** Binary angle (u16, 65536 = 360°) from +x towards +y. */
    Facing: { angle: new Uint16Array(capacity) },
    Collider: { radius: f32() },
    /** Held movement direction, length ≤ 1; `gait` = index in GAITS (0 sneak, 1 walk, 2 run). */
    MoveIntent: { dx: f32(), dy: f32(), gait: new Uint8Array(capacity).fill(1) },
    /** World point the entity aims at; `active` = 0 until the first aim command. */
    AimIntent: { x: f32(), y: f32(), active: new Uint8Array(capacity) },
    MoveStats: { speedPerTick: f32() },
    Player: { id: new Uint16Array(capacity) },
    /**
     * Zombie brain and body (Stage 4, `ai/*`). `state` = ZombieState, `stateTick` = tick when the
     * current state (or its timer) ends, `targetId` = StableId of the chased player (0 = none),
     * `tx`/`ty` = goal point (last known position, noise, wander point), `memoryUntil` = tick
     * until which a lost target is still pursued, `alert` = volume of the noise being
     * investigated, `speedMul` = spawn spread of the type's speeds, `tz` = floor index of the
     * goal (another floor than the zombie's: heard through a ceiling, see `ai/floors.ts`).
     */
    Zombie: {
      is: new Uint8Array(capacity),
      type: new Uint16Array(capacity),
      state: new Uint8Array(capacity),
      stateTick: new Uint32Array(capacity),
      targetId: new Uint32Array(capacity),
      tx: f32(),
      ty: f32(),
      memoryUntil: new Uint32Array(capacity),
      alert: f32(),
      hp: f32(),
      speedMul: f32(),
      /** Ticks with (almost) no progress while trying to move; triggers a re-path. */
      stuck: new Uint16Array(capacity),
      tz: new Int16Array(capacity),
    },
    /**
     * Animal brain and body (`animals/*`). `state` = AnimalState, `stateTick` = end of the current
     * graze pause / wander leg / minimum flee time / bird despawn, `tx`/`ty` = goal point,
     * `fromX`/`fromY` = what it flees from, `homeX`/`homeY` = spawn point (wander centre).
     * Kept after death (corpse, `state` dead) and after a bird flew off (`state` gone, no
     * Position: not rendered).
     */
    Animal: {
      is: new Uint8Array(capacity),
      type: new Uint16Array(capacity),
      state: new Uint8Array(capacity),
      stateTick: new Uint32Array(capacity),
      tx: f32(),
      ty: f32(),
      fromX: f32(),
      fromY: f32(),
      homeX: f32(),
      homeY: f32(),
      hp: f32(),
    },
  };
}

export type Components = ReturnType<typeof createComponents>;
