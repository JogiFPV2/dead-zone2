import type {
  CharacterProfileView,
  CombatView,
  CraftingView,
  SkillView,
  GroundPileView,
  StorageMarkerView,
  ActionView,
  ClockView,
  ContainerId,
  ContainerView,
  DeathCause,
  EquipSlot,
  InventoryView,
  ItemId,
  NearbyContainerView,
  SimEvent,
  SimViewPatch,
  ViewStat,
  WoundView,
} from '@deadzone/protocol';

/**
 * Game-side state read by the (future) DOM HUD. Framework-agnostic: pure reducer + tiny store.
 * Source of truth stays in the sim; this only mirrors `view` / `events` / `error` messages.
 */
export interface PlayerState {
  alive: boolean;
  sleeping: boolean;
  stats: Readonly<Partial<Record<ViewStat, number>>>;
  /** Visible moodles by content id → level (≥ 1); level 0 removes the entry. */
  moodles: Readonly<Record<string, number>>;
  wounds: readonly WoundView[];
}

/** Main inventory: the latest summary plus every carried container (patched by id). */
export interface InventoryState {
  container: ContainerId;
  loadKg: number;
  capacityKg: number;
  hardLimitKg: number;
  carryLoad: number;
  equipped: Readonly<Partial<Record<EquipSlot, ItemId>>>;
  /** Main inventory and carried bags by container id (full content each). */
  containers: Readonly<Record<ContainerId, ContainerView>>;
}

export interface GameState {
  status: 'booting' | 'running' | 'error';
  /** Last sim tick seen in a view/events message. */
  tick: number;
  clock?: ClockView;
  player: PlayerState;
  inventory?: InventoryState;
  /** Opened container (loot panel); absent = closed. */
  container?: ContainerView;
  /** Containers in reach (full list from the last patch that had it). */
  nearby: readonly NearbyContainerView[];
  /** Ground piles within marker range (view.groundPiles). */
  groundPiles: readonly GroundPileView[];
  /** World storage within marker range with fill 0..1 (view.storages; shelf props). */
  storages: readonly StorageMarkerView[];
  /** Current timed action; absent = none. */
  action?: ActionView;
  /** Recipes with their state and stations nearby (view.crafting, full when it changes). */
  crafting?: CraftingView;
  /** Skills of the local player (view.skills, full list). */
  skills: readonly SkillView[];
  /** The local player's created character (view.characterProfile; look, profession, traits). */
  characterProfile?: CharacterProfileView;
  death?: {
    cause: DeathCause;
    day: number;
    minuteOfDay: number;
    tick: number;
    daysSurvived?: number;
    zombiesKilled?: number;
  };
  /** Threat 0–100 (view.threat; 0 = safe). */
  threat: number;
  /** Combat state of the local player (kills, weapon, cooldown). */
  combat?: CombatView;
  /** Suggested game speed from the sim (sleep); the host decides whether to apply it. */
  timeScaleHint: 1 | 2 | 4;
  /** Most recent events, newest last (bounded; for HUD toasts / debug). */
  recentEvents: readonly SimEvent[];
  error?: string;
}

export const MAX_RECENT_EVENTS = 50;

export const INITIAL_GAME_STATE: GameState = {
  status: 'booting',
  tick: 0,
  player: { alive: true, sleeping: false, stats: {}, moodles: {}, wounds: [] },
  nearby: [],
  groundPiles: [],
  storages: [],
  skills: [],
  threat: 0,
  timeScaleHint: 1,
  recentEvents: [],
};

export type GameAction =
  | { type: 'view'; view: SimViewPatch; tick: number }
  | { type: 'events'; events: readonly SimEvent[]; tick: number }
  | { type: 'error'; message: string };

function applyInventory(prev: InventoryState | undefined, v: InventoryView): InventoryState {
  let containers = prev?.containers ?? {};
  if (v.containers?.length || v.removed?.length) {
    const next: Record<ContainerId, ContainerView> = { ...containers };
    for (const c of v.containers ?? []) next[c.id] = c;
    for (const id of v.removed ?? []) delete next[id];
    containers = next;
  }
  return {
    container: v.container,
    loadKg: v.loadKg,
    capacityKg: v.capacityKg,
    hardLimitKg: v.hardLimitKg,
    carryLoad: v.carryLoad,
    equipped: v.equipped,
    containers,
  };
}

/** `undefined` = not in the patch (keep), `null` = cleared, otherwise the new value. */
function patchNullable<K extends 'container' | 'action'>(
  s: GameState,
  key: K,
  value: NonNullable<GameState[K]> | null | undefined,
): GameState {
  if (value === undefined) return s;
  if (value === null) {
    if (s[key] === undefined) return s;
    const next = { ...s };
    delete next[key];
    return next;
  }
  return { ...s, [key]: value };
}

function applyView(s: GameState, view: SimViewPatch, tick: number): GameState {
  const p = view.player;
  let player = s.player;
  if (p) {
    let moodles = player.moodles;
    if (p.moodles?.length) {
      const next: Record<string, number> = { ...moodles };
      for (const m of p.moodles) {
        if (m.level > 0) next[m.id] = m.level;
        else delete next[m.id];
      }
      moodles = next;
    }
    player = {
      alive: p.alive ?? player.alive,
      sleeping: p.sleeping ?? player.sleeping,
      stats: p.stats ? { ...player.stats, ...p.stats } : player.stats,
      moodles,
      wounds: p.wounds ?? player.wounds,
    };
  }
  let next: GameState = {
    ...s,
    status: s.status === 'error' ? 'error' : 'running',
    tick: Math.max(s.tick, tick),
    ...(view.clock ? { clock: view.clock } : {}),
    ...(view.inventory ? { inventory: applyInventory(s.inventory, view.inventory) } : {}),
    ...(view.nearby ? { nearby: view.nearby } : {}),
    ...(view.groundPiles ? { groundPiles: view.groundPiles } : {}),
    ...(view.storages ? { storages: view.storages } : {}),
    ...(view.threat !== undefined ? { threat: view.threat } : {}),
    ...(view.combat ? { combat: view.combat } : {}),
    ...(view.crafting ? { crafting: view.crafting } : {}),
    ...(view.skills ? { skills: view.skills } : {}),
    ...(view.characterProfile ? { characterProfile: view.characterProfile } : {}),
    player,
  };
  next = patchNullable(next, 'container', view.container);
  next = patchNullable(next, 'action', view.action);
  return next;
}

function applyEvents(s: GameState, events: readonly SimEvent[], tick: number): GameState {
  if (events.length === 0) return s;
  let next: GameState = { ...s, tick: Math.max(s.tick, tick) };
  for (const e of events) {
    if (e.type === 'died') {
      next = {
        ...next,
        death: {
          cause: e.cause,
          day: e.day,
          minuteOfDay: e.minuteOfDay,
          tick: e.tick,
          ...(e.daysSurvived !== undefined ? { daysSurvived: e.daysSurvived } : {}),
          ...(e.zombiesKilled !== undefined ? { zombiesKilled: e.zombiesKilled } : {}),
        },
        player: { ...next.player, alive: false, sleeping: false },
      };
    } else if (e.type === 'fellAsleep') {
      next = { ...next, player: { ...next.player, sleeping: true } };
    } else if (e.type === 'wokeUp') {
      next = { ...next, player: { ...next.player, sleeping: false } };
    } else if (e.type === 'timeScaleHint') {
      next = { ...next, timeScaleHint: e.speed };
    }
  }
  const recent = [...s.recentEvents, ...events];
  next.recentEvents = recent.length > MAX_RECENT_EVENTS ? recent.slice(-MAX_RECENT_EVENTS) : recent;
  return next;
}

/** Pure reducer; returns the same object when nothing changed. */
export function reduceGameState(s: GameState, a: GameAction): GameState {
  switch (a.type) {
    case 'view':
      return applyView(s, a.view, a.tick);
    case 'events':
      return applyEvents(s, a.events, a.tick);
    case 'error':
      return { ...s, status: 'error', error: a.message };
  }
}

export type GameStateListener = (next: GameState, prev: GameState, action: GameAction) => void;

export class GameStateStore {
  private state: GameState;
  private readonly listeners = new Set<GameStateListener>();

  constructor(initial: GameState = INITIAL_GAME_STATE) {
    this.state = initial;
  }

  get(): GameState {
    return this.state;
  }

  dispatch(action: GameAction): void {
    const prev = this.state;
    const next = reduceGameState(prev, action);
    if (next === prev) return;
    this.state = next;
    for (const l of this.listeners) l(next, prev, action);
  }

  subscribe(listener: GameStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Anything that emits sim view/events/error (the worker client; the mock has none). */
export interface SimStateSource {
  onView(cb: (view: SimViewPatch, tick: number) => void): () => void;
  onEvents(cb: (events: SimEvent[], tick: number) => void): () => void;
  onError(cb: (message: string) => void): () => void;
}

/** Feeds a sim source into the store; returns an unsubscribe function. */
export function connectSimState(store: GameStateStore, sim: SimStateSource): () => void {
  const offs = [
    sim.onView((view, tick) => store.dispatch({ type: 'view', view, tick })),
    sim.onEvents((events, tick) => store.dispatch({ type: 'events', events, tick })),
    sim.onError((message) => store.dispatch({ type: 'error', message })),
  ];
  return () => offs.forEach((off) => off());
}
