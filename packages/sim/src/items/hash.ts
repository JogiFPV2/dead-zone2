import { EQUIP_SLOTS } from '@deadzone/protocol';
import { hashString32 } from '../core/rng.js';
import type { HashWriter } from '../core/hash.js';
import type { ItemStore } from './store.js';
import { hashLures } from '../lures/lures.js';

const KINDS = ['inventory', 'bag', 'world', 'ground'] as const;
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
    }
  }
  hashLures(st, h);
}
