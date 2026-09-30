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
    /** Held movement direction, length ≤ 1. */
    MoveIntent: { dx: f32(), dy: f32() },
    /** World point the entity aims at; `active` = 0 until the first aim command. */
    AimIntent: { x: f32(), y: f32(), active: new Uint8Array(capacity) },
    MoveStats: { speedPerTick: f32() },
    Player: { id: new Uint16Array(capacity) },
  };
}

export type Components = ReturnType<typeof createComponents>;
