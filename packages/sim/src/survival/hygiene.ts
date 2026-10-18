import {
  CHUNK_SIZE,
  type CommandRejectReason,
  type UseWaterCommand,
  type WaterUse,
} from '@deadzone/protocol';
import { newAction, registerAction, startAction } from '../actions/queue.js';
import type { SimWorld } from '../core/world.js';
import { playerItems } from '../items/inventory.js';
import { floorZ } from '../world/levels.js';
import { clampStat, type SurvivalWorld } from './state.js';

/**
 * Hygiene and mains water (docs 9.54, `worldSettings.survival.hygiene`). Dirt 0..100
 * (`SurvivalWorld.dirt`) grows by `dirtPerHour` every game minute; above `unhappyFromDirt` it
 * adds unhappiness (linear up to `unhappinessPerHourAtMax` at 100). `useWater {use}` runs a timed
 * action at a fixture in reach (`reachTiles`): `drink` / `wash` at a tap (`tapTag`: sinks and
 * washbasins; container types or placeables), `shower` (`showerTag`), `bath` (`bathTag`). All
 * need mains water (`items.water`, `no-water`); without the fixture: `no-station`.
 */

const KIND: Record<WaterUse, 'drinkTap' | 'wash' | 'shower' | 'bath'> = {
  drink: 'drinkTap',
  wash: 'wash',
  shower: 'shower',
  bath: 'bath',
};

const cfgOf = (w: SimWorld) => w.survival?.content.survival.hygiene;

function tagFor(w: SimWorld, use: WaterUse): string {
  const h = cfgOf(w)!;
  return use === 'shower' ? h.showerTag : use === 'bath' ? h.bathTag : h.tapTag;
}

/** Map object `contentId` carries `tag` (placeable item tags or container type tags). */
export function objectHasTag(w: SimWorld, contentId: string, tag: string): boolean {
  const c = w.items?.content;
  if (!c) return false;
  const item = c.itemIndex.get(contentId);
  if (item !== undefined && c.items[item]!.tags.includes(tag)) return true;
  const t = c.containerTypeIndex.get(contentId);
  return t !== undefined && (c.containerTypes[t]!.tags ?? []).includes(tag);
}

/** A fixture tagged `tag` within `hygiene.reachTiles` of the player (same floor). */
export function fixtureNear(w: SimWorld, eid: number, tag: string): boolean {
  const h = cfgOf(w);
  if (!h) return false;
  const { Position } = w.c;
  const px = Position.x[eid] ?? 0;
  const py = Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const r = h.reachTiles;
  for (let cy = Math.floor((py - r) / CHUNK_SIZE); cy <= Math.floor((py + r) / CHUNK_SIZE); cy++) {
    for (
      let cx = Math.floor((px - r) / CHUNK_SIZE);
      cx <= Math.floor((px + r) / CHUNK_SIZE);
      cx++
    ) {
      for (const obj of w.map.getChunk(cx, cy, z)?.objects ?? []) {
        const dx = cx * CHUNK_SIZE + obj.x + 0.5 - px;
        const dy = cy * CHUNK_SIZE + obj.y + 0.5 - py;
        if (dx * dx + dy * dy <= r * r && objectHasTag(w, obj.contentId, tag)) return true;
      }
    }
  }
  return false;
}

/** Why `use` cannot run now (undefined = it can). */
export function waterReason(
  w: SimWorld,
  eid: number,
  use: WaterUse,
): CommandRejectReason | undefined {
  const s = w.survival;
  if (!s || !w.items || !cfgOf(w) || s.asleep[eid]) return 'invalid-state';
  if (!fixtureNear(w, eid, tagFor(w, use))) return 'no-station';
  if (!w.items.water) return 'no-water';
  if (use === 'drink' && (s.vitals.thirst[eid] ?? 0) <= 0) return 'invalid-state';
  return undefined;
}

export function applyUseWater(
  w: SimWorld,
  eid: number,
  cmd: UseWaterCommand,
): CommandRejectReason | undefined {
  if (!w.items || !playerItems(w, eid)) return 'invalid-state';
  if (!(cmd.use in KIND)) return 'invalid-target';
  return startAction(w, eid, newAction(KIND[cmd.use]));
}

/** Timed action of a water use (for the furniture menu). */
export const waterAction = (use: WaterUse) => newAction(KIND[use]);

export function registerHygieneActions(): void {
  for (const use of ['drink', 'wash', 'shower', 'bath'] as const) {
    registerAction(KIND[use], {
      validate: (w, eid) => waterReason(w, eid, use),
      durationMin(w) {
        const h = cfgOf(w)!;
        return use === 'drink' ? h.drinkTap.durationMin : h[use].durationMin;
      },
      complete(w, eid) {
        const s = w.survival!;
        const h = s.content.survival.hygiene;
        const v = s.vitals;
        if (use === 'drink') {
          v.thirst[eid] = clampStat((v.thirst[eid] ?? 0) - h.drinkTap.thirst);
          return;
        }
        const c = h[use];
        s.dirt[eid] = Math.fround(Math.max(0, (s.dirt[eid] ?? 0) - c.dirt));
        v.unhappiness[eid] = clampStat((v.unhappiness[eid] ?? 0) - c.unhappiness);
        v.stress[eid] = clampStat((v.stress[eid] ?? 0) - c.stress);
        w.events.push({
          type: 'washed',
          tick: w.tick,
          playerId: w.c.Player.id[eid] ?? 0,
          use,
          dirt: Math.round(s.dirt[eid] ?? 0),
        });
      },
    });
  }
}

/** Per game minute (survival step): dirt grows; dirty players get unhappier. */
export function hygieneMinute(s: SurvivalWorld, eid: number): void {
  const h = s.content.survival.hygiene;
  if (!h || h.dirtPerHour <= 0) return;
  const dirt = Math.min(100, (s.dirt[eid] ?? 0) + h.dirtPerHour / 60);
  s.dirt[eid] = Math.fround(dirt);
  if (dirt > h.unhappyFromDirt && h.unhappyFromDirt < 100) {
    const k = (dirt - h.unhappyFromDirt) / (100 - h.unhappyFromDirt);
    const u = s.vitals.unhappiness;
    u[eid] = clampStat((u[eid] ?? 0) + (h.unhappinessPerHourAtMax / 60) * k);
  }
}
