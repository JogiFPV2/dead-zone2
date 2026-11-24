import { hashUtilities } from './utilities.js';
import { EQUIP_SLOTS } from '@deadzone/protocol';
import { hashString32 } from '../core/rng.js';
import type { HashWriter } from '../core/hash.js';
import type { ItemStore } from './store.js';
import { hashLures } from '../lures/lures.js';
import { hashProgress } from '../progress/skills.js';
import { hashCharacters } from '../character/character.js';
import { hashTraitSince } from '../character/dynamic-traits.js';
import { hashVhsWatched } from '../leisure/leisure.js';

const KINDS = [
  'inventory',
  'bag',
  'world',
  'ground',
  'corpse',
  'hidden',
  'vehicle-trunk',
  'vehicle-glovebox',
] as const;
const byNumber = (a: number, b: number): number => a - b;

/** Items section of the state hash: every container, item, equip slot and action, by id. */
export function hashItems(st: ItemStore, h: HashWriter): void {
  h.u32(st.nextItemId)
    .u32(st.nextContainerId)
    .u32(st.powered ? 1 : 0);
  const cids = [...st.containers.keys()].sort(byNumber);
  h.u32(cids.length);
  for (const id of cids) {
    const c = st.containers.get(id)!;
    h.u32(id)
      .u32(KINDS.indexOf(c.kind))
      .u32(c.owner)
      .u32(c.type + 1);
    h.u32(c.x)
      .u32(c.y)
      .u32(c.z)
      .u32(c.lootKey)
      .u32(c.lootDone ? 1 : 0);
    h.u32(c.roomType ? hashString32(c.roomType) : 0);
    if (c.kind === 'corpse') h.u32(c.lootTable ? hashString32(c.lootTable) : 0);
    h.u32(c.searchedBy.length);
    for (const sid of c.searchedBy) h.u32(sid);
    h.u32(c.items.length);
    for (const item of c.items) h.u32(item);
  }
  const iids = [...st.items.keys()].sort(byNumber);
  h.u32(iids.length);
  for (const id of iids) {
    const i = st.items.get(id)!;
    h.u32(id).u32(i.def).u32(i.loc).u32(i.count).u32(i.condition).u32(i.uses);
    h.f32(i.ageMin)
      .u32(i.ageStamp)
      .u32(i.inner)
      .u32(i.placed ? 1 : 0);
    // Only when thawing (older goldens unchanged).
    if (i.thawUntil !== undefined) h.u32(0x7468_6177).u32(i.thawUntil);
    if (i.burnt) h.u32(0x6275_726e);
    if (i.buildingId !== undefined)
      h.u32(0x6b65_7901)
        .u32(i.buildingId % 0x1_0000_0000)
        .u32(Math.floor(i.buildingId / 0x1_0000_0000));
  }
  const pids = [...st.players.keys()].sort(byNumber);
  h.u32(pids.length);
  for (const sid of pids) {
    const p = st.players.get(sid)!;
    h.u32(sid).u32(p.inventory).u32(p.open);
    for (const slot of EQUIP_SLOTS) h.u32(p.slots.get(slot) ?? 0);
    const actions = p.current ? [p.current, ...p.queue] : [];
    h.u32(actions.length);
    for (const a of actions) {
      h.u32(a.kind)
        .u32(a.startTick)
        .u32(a.endTick)
        .u32(a.item)
        .u32(a.container)
        .u32(a.part + 1);
      if (a.spot) h.u32(0x5907_0001).u32(a.spot.x).u32(a.spot.y).u32(a.spot.z);
      if (a.edge !== undefined)
        h.u32(0xed6e_0001)
          .u32(a.edge % 0x100000000)
          .u32(Math.floor(a.edge / 0x100000000));
      if (a.vehicle !== undefined)
        h.u32(0x7e41_0001)
          .u32(a.vehicle)
          .u32((a.seat ?? -1) + 1);
      if (a.pump) h.u32(0x7e41_0002).u32(a.pump[0]).u32(a.pump[1]);
      if (a.recipe) {
        h.u32(a.recipe).u32(a.use.length);
        for (const id of a.use) h.u32(id);
      }
    }
  }
  const backWeapons = pids
    .map((sid) => [sid, st.players.get(sid)!.backWeapon] as const)
    .filter(([, item]) => item !== 0);
  if (backWeapons.length > 0) {
    h.u32(0xbac0_0001).u32(backWeapons.length);
    for (const [sid, item] of backWeapons) h.u32(sid).u32(item);
  }
  const leftHands = pids.filter((sid) => st.players.get(sid)!.activeHand);
  if (leftHands.length > 0) {
    h.u32(0x4a2d_0001).u32(leftHands.length);
    for (const sid of leftHands) h.u32(sid);
  }
  // Corpse and hidden-cache indexes (only when present: older golden hashes stay valid).
  if (st.corpses.size > 0) {
    h.u32(0xc0a5_0001).u32(st.corpses.size);
    for (const sid of [...st.corpses.keys()].sort(byNumber)) h.u32(sid).u32(st.corpses.get(sid)!);
  }
  if (st.hidden.size > 0) {
    h.u32(0x41dd_0001).u32(st.hidden.size);
    for (const id of [...st.hidden.values()].sort(byNumber)) h.u32(id);
  }
  // Car keys (only when there are any: older goldens stay valid).
  const keys = iids.filter((id) => st.items.get(id)!.vehicle !== undefined);
  if (keys.length > 0) {
    h.u32(0x6e70_0001).u32(keys.length);
    for (const id of keys) h.u32(id).u32(st.items.get(id)!.vehicle!);
  }
  // Gas can levels and pump reserves (only when there are any: older goldens stay valid).
  const cans = iids.filter((id) => st.items.get(id)!.fuelL !== undefined);
  if (cans.length > 0) {
    h.u32(0x6e70_0002).u32(cans.length);
    for (const id of cans) h.u32(id).f32(st.items.get(id)!.fuelL!);
  }
  // Improvised weapon wear (only when there is any: older goldens stay valid).
  const worn = iids.filter((id) => st.items.get(id)!.wear !== undefined);
  if (worn.length > 0) {
    h.u32(0x6e70_0004).u32(worn.length);
    for (const id of worn) h.u32(id).u32(st.items.get(id)!.wear!);
  }
  if (st.pumps.size > 0) {
    h.u32(0x6e70_0003).u32(st.pumps.size);
    for (const k of [...st.pumps.keys()].sort()) {
      for (const n of k.split(',')) h.u32(Number(n));
      h.f32(st.pumps.get(k)!);
    }
  }
  if (st.waterTanks && st.waterTanks.size > 0) {
    h.u32(0x6e70_0005).u32(st.waterTanks.size);
    for (const k of [...st.waterTanks.keys()].sort()) {
      for (const n of k.split(',')) h.u32(Number(n) + 0x8000);
      h.f32(st.waterTanks.get(k)!);
    }
  }
  hashLures(st, h);
  hashProgress(st, h);
  hashCharacters(st, h);
  hashTraitSince(st, h);
  hashVhsWatched(st, h);
  hashUtilities(st, h);
  if (st.magOf.size > 0 || st.jammed.size > 0) {
    h.u32(st.magOf.size).u32(st.jammed.size);
    for (const id of [...st.magOf.keys()].sort(byNumber)) h.u32(id).u32(st.magOf.get(id)!);
    for (const id of [...st.jammed].sort(byNumber)) h.u32(id);
  }
}
