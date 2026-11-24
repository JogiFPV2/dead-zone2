import type {
  EdgeSide,
  OpeningActionType,
  OpeningState,
  SimEvent,
  WindowCoverView,
} from '@deadzone/protocol';

/**
 * Opening targeting for the interact key (F): which door / gate / window edge, if any, the
 * player acts on, and what F does there (tap = the main use, hold = a small menu of the timed
 * actions: smash, barricade, remove glass / planks, force). Pure (tests); the game feeds it the
 * edges of `OpeningsView` and their state from the sim views.
 */

/** Edges whose centre is within this many tiles count as in reach (sim reach: 1.5). */
export const DOOR_REACH_TILES = 1.4;
/** An opening this close (tiles from its centre) wins over a container in reach. */
export const DOOR_FIRST_TILES = 0.9;

/** Edge kinds F acts on. */
export type TargetKind = 'door' | 'gate' | 'window';

export interface DoorEdge {
  tx: number;
  ty: number;
  z: number;
  side: EdgeSide;
  /** Default `door`. */
  kind?: TargetKind;
}

/** Sim state of an edge (`OpeningView`): planks 0..4, window glass. */
export interface OpeningInfo {
  state: OpeningState;
  barricade?: number;
  glass?: boolean;
  /** Window cover (protocol 47); absent = not covered. */
  cover?: WindowCoverView;
}

export interface DoorTarget extends DoorEdge {
  kind: TargetKind;
  /** Distance (tiles) from the player to the edge centre. */
  dist: number;
  state: OpeningState;
  /** Planks over the edge (0..4). */
  barricade: number;
  /** Window: glass (pane or shards) in the frame. */
  glass: boolean;
  /** Window cover (protocol 47); absent = not covered. */
  cover?: WindowCoverView;
}

/** Max planks over an edge (`worldSettings.openings.barricade.maxPlanks`). */
export const MAX_PLANKS = 4;

/** Centre of an edge in sim tiles: north edge (tx + 0.5, ty), west edge (tx, ty + 0.5). */
export const doorCentre = (e: DoorEdge): { x: number; y: number } =>
  e.side === 'n' ? { x: e.tx + 0.5, y: e.ty } : { x: e.tx, y: e.ty + 0.5 };

export const edgeKey = (e: DoorEdge): string => `${e.tx},${e.ty},${e.z},${e.side}`;

/**
 * Nearest door / gate / window on the player's level within `DOOR_REACH_TILES`. Smashed doors
 * and gates (`broken`) have nothing left to use and are skipped; broken windows stay (climb
 * through, clear the glass, board up).
 */
export function nearestDoor(
  edges: readonly DoorEdge[],
  infoOf: (e: DoorEdge) => OpeningInfo | OpeningState,
  x: number,
  y: number,
  z: number,
): DoorTarget | undefined {
  let best: DoorTarget | undefined;
  for (const e of edges) {
    if (e.z !== z) continue;
    const c = doorCentre(e);
    const dist = Math.hypot(c.x - x, c.y - y);
    if (dist > DOOR_REACH_TILES || (best && dist >= best.dist)) continue;
    const raw = infoOf(e);
    const info = typeof raw === 'string' ? { state: raw } : raw;
    const kind = e.kind ?? 'door';
    if (info.state === 'broken' && kind !== 'window') continue;
    best = {
      tx: e.tx,
      ty: e.ty,
      z: e.z,
      side: e.side,
      kind,
      dist,
      state: info.state,
      barricade: info.barricade ?? 0,
      glass: info.glass ?? kind === 'window',
      ...(kind === 'window' && info.cover ? { cover: info.cover } : {}),
    };
  }
  return best;
}

/** F tap: the opening is used instead of the container when nothing else is in reach or it is very close. */
export const doorWins = (door: DoorTarget | undefined, hasContainer: boolean): boolean =>
  door !== undefined && (!hasContainer || door.dist < DOOR_FIRST_TILES);

/** A sim command on an opening edge. */
export type OpeningCmd = 'toggleDoor' | OpeningActionType | 'coverWindow' | 'uncoverWindow';

export interface OpeningOption {
  cmd: OpeningCmd;
  label: string;
  /** `coverWindow` from the item picker: the carried item instance to hang. */
  item?: number;
}

/** Menu entry that opens the cover item picker (`coverWindow` without an item). */
export const COVER_PICK_LABEL = 'Zasłoń…';

const opt = (cmd: OpeningCmd, label: string): OpeningOption => ({ cmd, label });

/** F tap on the opening; undefined = the tap opens the menu (`openingMenu`). */
export function openingPrimary(t: DoorTarget): OpeningOption | undefined {
  if (t.barricade > 0) return undefined;
  if (t.kind === 'window') {
    // Closed window: F opens it like a door (Paweł 24.11); open / smashed: climb through
    // (closing it again is in the hold menu).
    if (t.state === 'closed') return opt('toggleDoor', 'Otwórz');
    return t.state === 'open' || t.state === 'broken' ? opt('climbThrough', 'Przejdź') : undefined;
  }
  if (t.state === 'open') return opt('toggleDoor', 'Zamknij');
  // A locked one still sends the toggle: the sim answers `locked` (toast „Zamknięte”).
  return opt('toggleDoor', 'Otwórz');
}

/** Hold F (or a tap without a main use): the timed actions that fit the edge's state. */
export function openingMenu(t: DoorTarget): OpeningOption[] {
  const out = timedMenu(t);
  // Window covers (protocol 47): any window state, planks or not; one cover per window. Last, so
  // the numbers of the older entries stay.
  if (t.kind === 'window') {
    out.push(t.cover ? opt('uncoverWindow', 'Zdejmij') : opt('coverWindow', COVER_PICK_LABEL));
  }
  return out;
}

function timedMenu(t: DoorTarget): OpeningOption[] {
  const out: OpeningOption[] = [];
  const more = t.barricade < MAX_PLANKS;
  if (t.barricade > 0) {
    out.push(opt('removeBarricade', 'Zdejmij deskę'));
    if (more) out.push(opt('barricade', 'Dobij deskę'));
    return out;
  }
  if (t.kind === 'window') {
    if (t.state === 'broken') {
      if (t.glass) out.push(opt('removeGlass', 'Usuń szkło'));
    } else {
      out.push(opt('toggleDoor', t.state === 'open' ? 'Zamknij' : 'Otwórz'));
      out.push(opt('smashWindow', 'Rozbij'));
    }
    out.push(opt('barricade', 'Zabarykaduj'));
    return out;
  }
  if (t.state === 'locked') out.push(opt('forceDoor', 'Wyważ'));
  if (t.state === 'closed' || t.state === 'locked') out.push(opt('barricade', 'Zabarykaduj'));
  return out;
}

/** Prompt verb at the opening (`[F] Otwórz`, `Zamknięte`, `Zabarykadowane`, `Okno` …). */
export function doorVerb(t: DoorTarget | OpeningState): string {
  if (typeof t === 'string') {
    if (t === 'open') return 'Zamknij';
    if (t === 'locked') return 'Zamknięte';
    return 'Otwórz';
  }
  if (t.barricade > 0) return 'Zabarykadowane';
  if (t.kind !== 'window' && t.state === 'locked') return 'Zamknięte';
  return openingPrimary(t)?.label ?? 'Okno';
}

/** Ring title of a timed opening action (`ActionKind`), undefined = not an opening action. */
export const OPENING_ACTION_TITLES: Readonly<Record<string, string>> = {
  smashWindow: 'Rozbijanie',
  climbThrough: 'Przechodzenie',
  removeGlass: 'Usuwanie szkła',
  barricade: 'Barykadowanie',
  removeBarricade: 'Zdejmowanie deski',
  forceDoor: 'Wyważanie',
  coverWindow: 'Zasłanianie',
  uncoverWindow: 'Zdejmowanie',
};

/** Toast for a `toggleDoor` rejected with `locked`. */
export const LOCKED_TOAST = 'Zamknięte';

/**
 * Polish toasts for the local player's opening commands: rejections (`locked`, `missing-tool`,
 * `missing-parts`, `invalid-state` on planks) and `doorForced`. `sent` remembers the target per
 * command seq so a generic rejection can name the reason („Zabarykadowane”).
 */
export class OpeningFeedback {
  private readonly bySeq = new Map<number, DoorTarget>();

  constructor(private readonly playerId: number) {}

  sent(seq: number, t: DoorTarget): void {
    this.bySeq.set(seq, t);
    if (this.bySeq.size > 32) this.bySeq.delete(this.bySeq.keys().next().value!);
  }

  toast(e: SimEvent): string | undefined {
    if (e.type === 'doorForced' && e.playerId === this.playerId) {
      return e.success ? 'Wyważone' : 'Nie puściło';
    }
    if (e.type !== 'commandRejected' || e.playerId !== this.playerId) return undefined;
    const t = this.bySeq.get(e.seq);
    this.bySeq.delete(e.seq);
    if (e.reason === 'locked') return LOCKED_TOAST;
    if (!t) return undefined;
    if (e.reason === 'missing-tool') return 'Brak narzędzia';
    if (e.reason === 'missing-parts') return 'Brak materiałów';
    if (e.reason === 'invalid-state') return t.barricade > 0 ? 'Zabarykadowane' : 'Nie da się';
    if (e.reason === 'invalid-target' && t.kind === 'window') return 'Tym nie zasłonisz';
    if (e.reason === 'out-of-range') return 'Za daleko';
    return undefined;
  }
}

/** Toast text for a sim event when it is the local player's `toggleDoor` hitting a locked door. */
export function lockedDoorToast(
  e: { type: string; playerId?: number; reason?: string },
  playerId: number,
): string | undefined {
  return e.type === 'commandRejected' && e.playerId === playerId && e.reason === 'locked'
    ? LOCKED_TOAST
    : undefined;
}
