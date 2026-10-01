import {
  OPENING_STATES,
  type EdgeSide,
  type OpeningState,
  type OpeningView,
  type SimEdgeKind,
  type SimMap,
} from '@deadzone/protocol';

/** `worldSettings.openings` (defaults = the schema defaults in packages/content). */
export interface OpeningsConfig {
  doorHp: number;
  windowHp: number;
  barricadeHp: number;
  zombieBashMul: number;
  bashNoise: { radiusTiles: number; volume: number };
  breakNoise: { radiusTiles: number; volume: number };
  toggleNoise: { radiusTiles: number; volume: number };
  windowSpeedMul: number;
  reachTiles: number;
}

export const DEFAULT_OPENINGS_CONFIG: OpeningsConfig = {
  doorHp: 60,
  windowHp: 6,
  barricadeHp: 150,
  zombieBashMul: 1,
  bashNoise: { radiusTiles: 14, volume: 0.8 },
  breakNoise: { radiusTiles: 20, volume: 1 },
  toggleNoise: { radiusTiles: 3, volume: 0.3 },
  windowSpeedMul: 0.3,
  reachTiles: 1.5,
};

/** Edge id kind: 0 = wall (or unknown), 1 = door, 2 = window. */
export const OpeningKind = { wall: 0, door: 1, window: 2 } as const;

export const OS = {
  open: OPENING_STATES.indexOf('open'),
  closed: OPENING_STATES.indexOf('closed'),
  locked: OPENING_STATES.indexOf('locked'),
  barricaded: OPENING_STATES.indexOf('barricaded'),
  broken: OPENING_STATES.indexOf('broken'),
} as const;

export interface OpeningEntry {
  kind: number;
  state: number;
  hp: number;
}

/**
 * Door / window state (world state: hashed and saved). Only edges that differ from the map
 * default (`closed`, full hp) are stored. Keys: `openingKey(side, tx, ty, z)`, numeric order is
 * the deterministic iteration order (hash, views).
 */
export interface OpeningsWorld {
  readonly cfg: OpeningsConfig;
  /** Edge id → OpeningKind (derived from `SimMap.edgeKinds`). */
  readonly kinds: Uint8Array;
  readonly states: Map<number, OpeningEntry>;
  /** Zombie eid → tick of its next blow at a door / window. */
  readonly bashAt: Map<number, number>;
  /** Bumped on every change (views). */
  version: number;
}

export function createOpeningsWorld(map: SimMap, cfg: OpeningsConfig): OpeningsWorld {
  const edgeKinds = map.edgeKinds ?? [];
  const kinds = new Uint8Array(Math.max(1, edgeKinds.length));
  edgeKinds.forEach((k: SimEdgeKind | null, id) => {
    kinds[id] = k === 'door' ? OpeningKind.door : k === 'window' ? OpeningKind.window : 0;
  });
  return { cfg, kinds, states: new Map(), bashAt: new Map(), version: 0 };
}

const SIDE_N = 0;
const SIDE_W = 1;
export const sideIndex = (side: EdgeSide): number => (side === 'n' ? SIDE_N : SIDE_W);

/** Packs an edge into a safe integer (z: 8 bits, ty / tx: 16 bits, side: 1 bit). */
export const openingKey = (side: number, tx: number, ty: number, z: number): number =>
  (((z + 0x80) * 0x10000 + (ty + 0x8000)) * 0x10000 + (tx + 0x8000)) * 2 + side;

export function unpackKey(key: number): { side: EdgeSide; tx: number; ty: number; z: number } {
  const side = key % 2;
  let k = (key - side) / 2;
  const tx = (k % 0x10000) - 0x8000;
  k = (k - (tx + 0x8000)) / 0x10000;
  const ty = (k % 0x10000) - 0x8000;
  const z = (k - (ty + 0x8000)) / 0x10000 - 0x80;
  return { side: side === SIDE_N ? 'n' : 'w', tx, ty, z };
}

export function maxHp(cfg: OpeningsConfig, kind: number, state: number): number {
  if (state === OS.barricaded) return cfg.barricadeHp;
  if (state === OS.broken) return 0;
  return kind === OpeningKind.door ? cfg.doorHp : cfg.windowHp;
}

export function stateOf(o: OpeningsWorld, key: number): OpeningEntry | undefined {
  return o.states.get(key);
}

/** Edge flag bits (TileGrid.edgeFlags*). */
export const EF = {
  present: 1,
  blocksMove: 2,
  blocksSight: 4,
  /** Counts as a wall for sound (attenuation). */
  muffles: 8,
  /** Door / window: zombies path through it (they bash it when closed). */
  opening: 16,
  /** Open / broken window: passable, but slows movement. */
  slow: 32,
} as const;

/** Flags of a door / window edge in a given state. */
export function openingFlags(kind: number, state: number): number {
  let f = EF.present | EF.opening;
  const passable = state === OS.open || state === OS.broken;
  if (!passable) f |= EF.blocksMove | EF.muffles;
  if (kind === OpeningKind.door) {
    if (!passable) f |= EF.blocksSight;
  } else {
    if (state === OS.barricaded) f |= EF.blocksSight;
    if (passable) f |= EF.slow;
  }
  return f;
}

/** Sets a state (hp = the state's max unless given); the default (closed, full hp) is not stored. */
export function setOpening(
  o: OpeningsWorld,
  key: number,
  kind: number,
  state: number,
  hp = maxHp(o.cfg, kind, state),
): void {
  if (state === OS.closed && hp >= maxHp(o.cfg, kind, state)) o.states.delete(key);
  else o.states.set(key, { kind, state, hp: Math.fround(hp) });
  o.version++;
}

export function openingView(o: OpeningsWorld, key: number, kind: number): OpeningView {
  const e = o.states.get(key);
  if (e) kind = e.kind;
  const state = e?.state ?? OS.closed;
  const { side, tx, ty, z } = unpackKey(key);
  return {
    tx,
    ty,
    z,
    side,
    kind: kind === OpeningKind.door ? 'door' : 'window',
    state: OPENING_STATES[state] as OpeningState,
    hp: Math.round((e?.hp ?? maxHp(o.cfg, kind, state)) * 10) / 10,
    maxHp: maxHp(o.cfg, kind, state),
  };
}
