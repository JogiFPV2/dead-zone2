import {
  BODY_PARTS,
  WOUND_KINDS,
  type CommandRejectReason,
  type WoundTreatment,
} from '@deadzone/protocol';
import { registerAction, newAction, startAction } from '../actions/queue.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems, consumeUse } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import { defOf, destroyItem, type ActionState, type ItemInstance } from '../items/store.js';
import { addXp, skillLevel } from '../progress/skills.js';
import { clampStat, type Wound } from './state.js';
import { recomputeWoundStats } from './wounds.js';

/**
 * Wound care (furniture/activities stage 3, docs 9.48): disinfecting (hydrogen peroxide, a
 * sterile dressing, vodka) and stitching with needle and thread. Fields on `Wound`:
 * `cleanUntilAge` (no new dirt infection while `ageMin` is below it) and `stitched`.
 */

type Cfg = NonNullable<SimWorld['survival']>['content']['survival']['wounds'];
const cfgOf = (w: SimWorld): Cfg => w.survival!.content.survival.wounds;

const woundsAt = (w: SimWorld, eid: number, part: number): Wound[] =>
  (w.survival?.wounds.get(w.c.StableId.value[eid] ?? 0) ?? []).filter((wd) => wd.part === part);

/** Disinfecting strength of a carried item (0 = not a disinfectant). */
export function disinfectPotency(w: SimWorld, item: ItemInstance): number {
  const def = defOf(w.items!, item);
  if (def.kind === 'medical' && def.medical.effects.includes('disinfect'))
    return def.medical.potency;
  return def.tags.includes(cfgOf(w).disinfect.liquidTag) ? cfgOf(w).disinfect.liquidPotency : 0;
}

const carried = (w: SimWorld, eid: number): ItemInstance[] => {
  const p = playerItems(w, eid);
  return p && w.items ? carriedItems(w.items, p.inventory) : [];
};
const withTag = (w: SimWorld, eid: number, tag: string): ItemInstance | undefined =>
  carried(w, eid).find((i) => defOf(w.items!, i).tags.includes(tag));

/** Disinfects every wound of `part` (also used by a sterile bandage): clean, protected, healed a bit. */
export function disinfectPart(w: SimWorld, eid: number, part: number, potency: number): number {
  const s = w.survival;
  if (!s) return 0;
  const cfg = cfgOf(w).disinfect;
  let n = 0;
  for (const wd of woundsAt(w, eid, part)) {
    wd.dirt = false;
    wd.cleanUntilAge = wd.ageMin + cfg.protectMin;
    wd.healed = Math.fround(Math.min(0.99, wd.healed + cfg.healBonus * potency));
    n++;
  }
  if (n > 0) {
    recomputeWoundStats(s, eid, w.c.StableId.value[eid] ?? 0);
    // It stings: a moment of pain until the next per-minute recompute.
    s.vitals.pain[eid] = clampStat((s.vitals.pain[eid] ?? 0) + cfg.painAdd);
  }
  return n;
}

/** Stitch success chance for this player (0..0.95). */
export function stitchChance(w: SimWorld, eid: number): number {
  const c = cfgOf(w).stitch;
  return Math.min(0.95, c.chance + c.chancePerLevel * skillLevel(w, eid, c.skill));
}

const stitchable = (w: SimWorld, wd: Wound): boolean =>
  !wd.stitched &&
  wd.healed < 1 &&
  (cfgOf(w).stitch.kinds as readonly string[]).includes(WOUND_KINDS[wd.kind] ?? '');

/** Why `treatment` cannot start on `part` now (undefined = it can). */
export function treatReason(
  w: SimWorld,
  eid: number,
  treatment: WoundTreatment,
  part: number,
  itemId?: number,
): CommandRejectReason | undefined {
  if (!w.survival || !w.items || !playerItems(w, eid)) return 'invalid-state';
  const wounds = woundsAt(w, eid, part);
  if (wounds.length === 0) return 'invalid-target';
  if (treatment === 'disinfect') {
    const item = pickDisinfectant(w, eid, itemId);
    return item ? undefined : 'missing-item';
  }
  if (!wounds.some((wd) => stitchable(w, wd))) return 'invalid-target';
  const c = cfgOf(w).stitch;
  if (!withTag(w, eid, c.needleTag)) return 'missing-tool';
  return pickThread(w, eid, itemId) ? undefined : 'missing-item';
}

function pickDisinfectant(w: SimWorld, eid: number, itemId?: number): ItemInstance | undefined {
  const list = carried(w, eid).filter((i) => disinfectPotency(w, i) > 0);
  return itemId === undefined ? list[0] : list.find((i) => i.id === itemId);
}

function pickThread(w: SimWorld, eid: number, itemId?: number): ItemInstance | undefined {
  const tag = cfgOf(w).stitch.threadTag;
  const list = carried(w, eid).filter((i) => defOf(w.items!, i).tags.includes(tag));
  return itemId === undefined ? list[0] : list.find((i) => i.id === itemId);
}

/** `treatWound {part, treatment, item?}`: starts the timed `disinfect` / `stitch` action. */
export function applyTreatWound(
  w: SimWorld,
  eid: number,
  part: number,
  treatment: WoundTreatment,
  itemId?: number,
): CommandRejectReason | undefined {
  if (part < 0) return 'invalid-target';
  const reason = treatReason(w, eid, treatment, part, itemId);
  if (reason) return reason;
  const item =
    treatment === 'disinfect' ? pickDisinfectant(w, eid, itemId)! : pickThread(w, eid, itemId)!;
  return startAction(w, eid, newAction(treatment, { item: item.id, part }));
}

function treated(w: SimWorld, eid: number, a: ActionState, item: string, success: boolean) {
  w.events.push({
    type: 'woundTreated',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    part: BODY_PARTS[a.part] ?? 'torso_upper',
    treatment: a.kind === kindStitch ? 'stitch' : 'disinfect',
    item,
    success,
  });
}

let kindStitch = -1;

let registered = false;

export function registerWoundCareActions(): void {
  if (registered) return;
  registered = true;
  kindStitch = newAction('stitch').kind;

  registerAction('disinfect', {
    validate: (w, eid, a) => treatReason(w, eid, 'disinfect', a.part, a.item),
    durationMin: (w) => cfgOf(w).disinfect.min,
    complete(w, eid, a) {
      const item = w.items!.items.get(a.item)!;
      const def = defOf(w.items!, item).id;
      disinfectPart(w, eid, a.part, disinfectPotency(w, item));
      consumeUse(w, item, undefined);
      const c = cfgOf(w).disinfect;
      addXp(w, eid, c.skill, c.xp);
      treated(w, eid, a, def, true);
    },
  });

  registerAction('stitch', {
    validate: (w, eid, a) => treatReason(w, eid, 'stitch', a.part, a.item),
    durationMin: (w) => cfgOf(w).stitch.min,
    complete(w, eid, a) {
      const st = w.items!;
      const c = cfgOf(w).stitch;
      const s = w.survival!;
      const thread = st.items.get(a.item)!;
      const def = defOf(st, thread).id;
      const success = w.rng.health.nextFloat() < stitchChance(w, eid);
      const sid = w.c.StableId.value[eid] ?? 0;
      if (success) {
        for (const wd of woundsAt(w, eid, a.part)) if (stitchable(w, wd)) wd.stitched = true;
        recomputeWoundStats(s, eid, sid);
      } else {
        s.vitals.pain[eid] = clampStat((s.vitals.pain[eid] ?? 0) + c.failPain);
      }
      if (thread.count > 1) thread.count--;
      else destroyItem(st, thread);
      st.version++;
      addXp(w, eid, c.skill, c.xp);
      treated(w, eid, a, def, success);
    },
  });
}
