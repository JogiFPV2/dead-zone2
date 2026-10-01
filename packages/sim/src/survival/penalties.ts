import { BODY_PARTS, WOUND_KINDS } from '@deadzone/protocol';
import { sortedQuery, type SimWorld } from '../core/world.js';
import type { SurvivalWorld } from './state.js';

/** Slots of `SurvivalWorld.penalties` (per entity × PENALTY_SLOTS). */
export const Pen = { move: 0, attack: 1, action: 2, vision: 3, blur: 4 } as const;
export const PENALTY_SLOTS = 5;

export const penalty = (s: SurvivalWorld, eid: number, slot: number): number =>
  s.penalties[eid * PENALTY_SLOTS + slot] ?? 0;

/** Multiplier 1 − penalty (speed, damage, sight). */
export const penaltyMul = (w: SimWorld, eid: number, slot: number): number =>
  w.survival ? 1 - penalty(w.survival, eid, slot) : 1;

type Group = 'head' | 'torso' | 'arm' | 'leg';
const STATS = ['moveSpeed', 'attackPower', 'actionSpeed', 'visionRange'] as const;

/**
 * Pipeline `penalties` (after moodles, every tick): `worldSettings.survival.woundPenalties`.
 * Per body group the heaviest wound counts (× `bandagedFactor` when bandaged); groups add up;
 * pain / fever / bleeding from their threshold add sight loss and blur; every sum is capped at
 * `maxPenalty` (blur at 1). Fever level = (body temperature − base) / `infection.feverMaxC` × 100.
 */
export function penaltiesSystem(w: SimWorld): void {
  const s = w.survival;
  if (!s) return;
  const cfg = s.content.survival.woundPenalties;
  const base = s.content.survival.temperature.bodyBaseC;
  const feverMax = s.content.survival.infection.feverMaxC;
  const sum = [0, 0, 0, 0];
  const group: Record<Group, number[]> = { head: [], torso: [], arm: [], leg: [] };
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    for (const g of Object.keys(group) as Group[]) group[g] = [0, 0, 0, 0];
    for (const wd of s.wounds.get(w.c.StableId.value[eid] ?? 0) ?? []) {
      const g: Group | undefined = cfg.bodyGroups[BODY_PARTS[wd.part] ?? ''];
      const kind = WOUND_KINDS[wd.kind];
      if (!g || !kind) continue;
      const row = cfg[cfg.severity[kind]][g];
      const f = wd.bandaged ? cfg.bandagedFactor : 1;
      const acc = group[g];
      for (let i = 0; i < STATS.length; i++) acc[i] = Math.max(acc[i]!, row[STATS[i]!] * f);
    }
    sum.fill(0);
    for (const g of Object.keys(group) as Group[]) {
      for (let i = 0; i < STATS.length; i++) sum[i]! += group[g][i]!;
    }
    let blur = 0;
    const v = s.vitals;
    const fever =
      feverMax > 0 ? (((v['body-temperature-c'][eid] ?? 0) - base) / feverMax) * 100 : 0;
    const levels = { pain: v.pain[eid] ?? 0, fever, bleeding: v.bleeding[eid] ?? 0 };
    for (const c of ['pain', 'fever', 'bleeding'] as const) {
      const cond = cfg.conditions[c];
      if (levels[c] >= cond.from) {
        sum[3]! += cond.visionRange;
        blur += cond.blur;
      }
    }
    const o = eid * PENALTY_SLOTS;
    for (let i = 0; i < STATS.length; i++) {
      s.penalties[o + i] = Math.fround(Math.min(cfg.maxPenalty, sum[i]!));
    }
    s.penalties[o + Pen.blur] = Math.fround(Math.min(1, blur));
  }
}
