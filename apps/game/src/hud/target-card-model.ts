import { entityNamePl, type EntityNameKind } from '@deadzone/content';
import type { TargetState, TargetView } from '@deadzone/protocol';
import { hpBand, type HpBand } from './zombie-hp-model.js';

/**
 * HUD target card (status block, under the HP bar; sim contract docs/sim-architecture.md 9.40).
 * Pure view model of `SimViewPatch.target`.
 */

export type TargetTone = 'calm' | 'warn' | 'danger' | 'dead';

export interface TargetCardVM {
  id: number;
  kind: TargetView['kind'];
  name: string;
  /** „12,4 m”. */
  distance: string;
  hpPct: number;
  band: HpBand;
  /** Behaviour chip (ŚCIGA, ATAKUJE …); absent for cars / players without a state. */
  state?: { label: string; tone: TargetTone };
  /** Why it is shown: NAMIERZONY (lock), CEL (aim), TRAFIONY (last hit). */
  source: TargetView['source'];
  sourceLabel: string;
  /** Only for `source: 'aim'` (Designer). */
  hitChancePct?: number;
}

const STATE_LABELS: Record<TargetState, { label: string; tone: TargetTone }> = {
  idle: { label: 'SPOKOJNY', tone: 'calm' },
  wander: { label: 'BŁĄDZI', tone: 'calm' },
  chasing: { label: 'ŚCIGA', tone: 'warn' },
  attacking: { label: 'ATAKUJE', tone: 'danger' },
  fleeing: { label: 'UCIEKA', tone: 'calm' },
  downed: { label: 'LEŻY', tone: 'calm' },
  dead: { label: 'MARTWY', tone: 'dead' },
};

const SOURCE_LABELS: Record<TargetView['source'], string> = {
  lock: 'NAMIERZONY',
  aim: 'CEL',
  hit: 'TRAFIONY',
};

const NAMED_KINDS: ReadonlySet<string> = new Set<EntityNameKind>(['zombie', 'animal', 'vehicle']);

/** Polish name: `entityNamePl` for zombies / animals / cars, else the sim's name (players). */
export function targetName(t: Pick<TargetView, 'kind' | 'typeId' | 'name'>): string {
  if (t.typeId && NAMED_KINDS.has(t.kind)) return entityNamePl(t.kind as EntityNameKind, t.typeId);
  return t.name || '?';
}

/** 0.1 m → „12,4 m” (Polish decimal comma). */
export const formatDistance = (m: number): string =>
  `${(Math.round(Math.max(0, m) * 10) / 10).toFixed(1).replace('.', ',')} m`;

export function targetCardVM(t: TargetView | undefined): TargetCardVM | undefined {
  if (!t) return undefined;
  const hpPct = Math.max(0, Math.min(100, Math.round(t.hpPct)));
  const dead = t.state === 'dead';
  return {
    id: t.id,
    kind: t.kind,
    name: targetName(t),
    distance: formatDistance(t.distanceM),
    hpPct,
    band: hpBand(hpPct / 100),
    ...(t.state ? { state: STATE_LABELS[t.state] } : {}),
    source: t.source,
    sourceLabel: SOURCE_LABELS[t.source],
    ...(t.source === 'aim' && t.hitChancePct !== undefined && !dead
      ? { hitChancePct: Math.max(0, Math.min(100, Math.round(t.hitChancePct))) }
      : {}),
  };
}

/**
 * Tab: the next target among `candidates` (ids sorted nearest first) after `current`; wraps,
 * and with no / an unknown current takes the nearest. Undefined when there is nobody.
 */
export function nextTargetId(
  candidates: readonly number[],
  current: number | undefined,
): number | undefined {
  if (candidates.length === 0) return undefined;
  const i = current === undefined ? -1 : candidates.indexOf(current);
  return candidates[(i + 1) % candidates.length];
}
