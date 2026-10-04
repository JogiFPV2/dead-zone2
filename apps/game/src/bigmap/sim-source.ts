import type {
  CommandRejectReason,
  MapMarkerView,
  SimEvent,
  WorldMapView,
} from '@deadzone/protocol';
import type { CommandBody } from '../sim/sim-client.js';
import {
  MARKER_COLORS,
  TRAIL_MAX_POINTS,
  clampMarkerText,
  decodeBase64,
  fogGrid,
  setDiscovered,
  type FogGrid,
  type Marker,
  type MarkerColor,
  type MarkerDraft,
} from './bigmap-model.js';
import type { BigMapSource } from './bigmap-source.js';

/** Polish toasts for rejected marker commands. */
export const MARKER_REJECT_TEXT: Partial<Record<CommandRejectReason, string>> = {
  'invalid-target': 'Nie można postawić tu znacznika',
  'marker-limit': 'Limit znaczników (200)',
  'unknown-marker': 'Ten znacznik już nie istnieje',
};

type MarkerCommand = Extract<CommandBody, { type: 'addMarker' | 'editMarker' | 'removeMarker' }>;

const colorOf = (c: string): MarkerColor =>
  (MARKER_COLORS as readonly string[]).includes(c) ? (c as MarkerColor) : 'white';

/**
 * The sim's player map (docs/sim-architecture.md 9.29) for the big map:
 * - `worldMap.bounds` + `discovered` (base64 bitmap, first view / load / new character) reset the
 *   fog, `chunksDiscovered` events add cells;
 * - `worldMap.trail` replaces the trail, `trailAdd` appends;
 * - `worldMap.markers` / `markersChanged` replace the marker list.
 * Marker commands go to the sim (applied at once, also in pause); `showOnMinimap` is client-only
 * (the sim does not store it), kept per marker id for the session.
 */
export class SimBigMapSource implements BigMapSource {
  private grid: FogGrid = fogGrid();
  private points: number[] = [];
  private trailCache: Float32Array | undefined;
  private list: Marker[] = [];
  private readonly hiddenOnMinimap = new Set<number>();
  /** seq → command type of marker commands in flight (rejections come back by seq). */
  private readonly pending = new Map<number, MarkerCommand['type']>();
  /** `showOnMinimap: false` for the next added marker. */
  private nextAddHidden: boolean[] = [];
  fogVersion = 0;
  trailVersion = 0;
  markersVersion = 0;

  constructor(
    /** Sends a command; returns its `seq`. */
    private readonly send: (cmd: MarkerCommand) => number,
    private readonly playerId: () => number | undefined = () => undefined,
    /** Toast for a rejected marker command. */
    private readonly onRejected: (text: string) => void = () => {},
  ) {}

  fog(): FogGrid {
    return this.grid;
  }

  trail(): Float32Array {
    return (this.trailCache ??= Float32Array.from(this.points));
  }

  markers(): readonly Marker[] {
    return this.list;
  }

  /** `SimViewPatch.worldMap` (missing field = unchanged). */
  applyView(w: WorldMapView | undefined): void {
    if (!w) return;
    if (w.bounds || w.discovered !== undefined) {
      const b = w.bounds ?? {
        cx0: this.grid.cx0,
        cy0: this.grid.cy0,
        cx1: this.grid.cx0 + this.grid.width - 1,
        cy1: this.grid.cy0 + this.grid.height - 1,
      };
      const next = fogGrid(b);
      if (w.discovered) next.bits.set(decodeBase64(w.discovered).subarray(0, next.bits.length));
      this.grid = next;
      this.fogVersion++;
    }
    if (w.trail) {
      this.points = [...w.trail];
      this.trailChanged();
    }
    if (w.trailAdd?.length) {
      this.points.push(...w.trailAdd);
      // The sim resends the whole trail when it drops old points; stay within its cap anyway.
      const over = this.points.length - TRAIL_MAX_POINTS * 2;
      if (over > 0) this.points.splice(0, over);
      this.trailChanged();
    }
    if (w.markers) this.setMarkers(w.markers);
  }

  applyEvents(events: readonly SimEvent[]): void {
    const me = this.playerId();
    for (const e of events) {
      if ('playerId' in e && me !== undefined && e.playerId !== me) continue;
      if (e.type === 'chunksDiscovered') {
        let changed = false;
        for (const [cx, cy] of e.cells) changed = setDiscovered(this.grid, cx, cy) || changed;
        if (changed) this.fogVersion++;
      } else if (e.type === 'markersChanged') {
        if (e.change === 'added' && this.nextAddHidden.shift()) this.hiddenOnMinimap.add(e.changed);
        if (e.change === 'removed') this.hiddenOnMinimap.delete(e.changed);
        this.setMarkers(e.markers);
      } else if (e.type === 'commandRejected') {
        const cmd = this.pending.get(e.seq);
        if (!cmd) continue;
        this.pending.delete(e.seq);
        if (cmd === 'addMarker') this.nextAddHidden.shift();
        this.onRejected(MARKER_REJECT_TEXT[e.reason] ?? 'Nie udało się zmienić znacznika');
      }
    }
  }

  addMarker(m: MarkerDraft): void {
    this.nextAddHidden.push(!m.showOnMinimap);
    this.track(
      this.send({
        type: 'addMarker',
        x: m.x,
        y: m.y,
        icon: m.icon,
        color: m.color,
        text: clampMarkerText(m.text),
      }),
      'addMarker',
    );
  }

  editMarker(id: number, m: MarkerDraft): void {
    if (m.showOnMinimap) this.hiddenOnMinimap.delete(id);
    else this.hiddenOnMinimap.add(id);
    this.track(
      this.send({
        type: 'editMarker',
        id,
        x: m.x,
        y: m.y,
        icon: m.icon,
        color: m.color,
        text: clampMarkerText(m.text),
      }),
      'editMarker',
    );
  }

  removeMarker(id: number): void {
    this.track(this.send({ type: 'removeMarker', id }), 'removeMarker');
  }

  private track(seq: number, type: MarkerCommand['type']): void {
    this.pending.set(seq, type);
    // Answers come within a tick or two; keep the map small if some never do.
    if (this.pending.size > 64) this.pending.delete(this.pending.keys().next().value!);
  }

  private trailChanged(): void {
    this.trailCache = undefined;
    this.trailVersion++;
  }

  private setMarkers(list: readonly MapMarkerView[]): void {
    this.list = list.map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
      icon: m.icon,
      color: colorOf(m.color),
      text: m.text,
      showOnMinimap: !this.hiddenOnMinimap.has(m.id),
    }));
    this.markersVersion++;
  }
}
