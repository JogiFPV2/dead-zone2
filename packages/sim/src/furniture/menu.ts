import { fallAsleep, sleepReason } from '../systems/sleep.js';
import {
  CHUNK_SIZE,
  type CommandRejectReason,
  type FurnitureActionView,
  type FurnitureReason,
  type FurnitureView,
  type UseFurnitureCommand,
  type WaterUse,
} from '@deadzone/protocol';
import { objectRect } from './footprint.js';
import { rectDist2 } from '../world/furniture.js';
import { furnitureActionPl, furnitureReasonPl } from '@deadzone/content';
import { newAction, previewAction, startAction } from '../actions/queue.js';
import { ticksPerGameMinute } from '../core/clock.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems } from '../items/actions.js';
import { craftSources, evalRecipe, stationHeats } from '../crafting/crafting.js';
import { switchKeyOf } from '../ai/state.js';
import { setCurtains, setLight } from './lighting.js';
import { objectHasTag, waterAction } from '../survival/hygiene.js';
import { applyItemCommand } from '../items/commands.js';
import { canReach, containerInReach, playerItems } from '../items/inventory.js';
import { searchSecMin } from '../items/search.js';
import { storageTypesOf } from '../items/loot.js';
import { defOf, tileKey, type ActionState } from '../items/store.js';
import { applyOpeningCommand, edgeCentre, edgeInReach } from '../openings/actions.js';
import { wearsGloves } from '../openings/timed.js';
import {
  currentState,
  edgeKindOf,
  isDoorLike,
  OpeningKind,
  openingKey,
  OS,
  unpackKey,
} from '../openings/state.js';
import { skillLevel } from '../progress/skills.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ } from '../world/levels.js';
import { carriedLockpicks, insideOf, knock, lockpickChance } from './locks.js';

/**
 * Context menu of furniture and edges (protocol 26, docs 9.47): `SimViewPatch.furnitureActions`
 * lists what is in reach with every action, enabled or not (reason code + Polish text from
 * `@deadzone/content`), and `useFurniture {furnitureId, actionId}` runs one. The command
 * rebuilds the same entry, so the menu and the sim never disagree. Older commands
 * (`toggleDoor`, `smashWindow`, …) keep working; the menu goes only through `useFurniture`.
 */

/** Map objects get ids from 2^42 up; edge keys (`openingKey`) stay below. */
export const OBJECT_ID_BASE = 2 ** 42;

export const objectFurnitureId = (x: number, y: number, z: number, n: number): number =>
  OBJECT_ID_BASE + (((z + 128) * 0x10000 + (y + 0x8000)) * 0x10000 + (x + 0x8000)) * 16 + n;

export function unpackObjectId(id: number): { x: number; y: number; z: number; n: number } {
  let k = id - OBJECT_ID_BASE;
  const n = k % 16;
  k = (k - n) / 16;
  const x = (k % 0x10000) - 0x8000;
  k = (k - (x + 0x8000)) / 0x10000;
  const y = (k % 0x10000) - 0x8000;
  const z = (k - (y + 0x8000)) / 0x10000 - 128;
  return { x, y, z, n };
}

/** Alarm lengths offered on a bed / sofa (`sleep-until:<h>`, besides `sleep-until:morning`). */
export const SLEEP_UNTIL_HOURS = [6, 7, 8, 9, 12] as const;

/** Polish dish name of a recipe: its first result item (`SimOptions.namesPl`), else the id. */
export function dishNamePl(
  w: SimWorld,
  r: { id: string; results: readonly { item: string }[] },
): string {
  const item = r.results[0]?.item;
  const name = item === undefined ? undefined : w.namesPl?.[item];
  if (name) return name;
  const raw = (item ?? r.id).replace(/^[^:]*:/, '').replace(/-/g, ' ');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Most entries in one menu patch (nearest to the aim point first). */
export const MAX_FURNITURE_ENTRIES = 8;

type Act = FurnitureActionView & {
  /** Runs the action (only called when enabled). */
  run?: () => CommandRejectReason | undefined;
};

const pct = (v: number): number => Math.max(0, Math.min(100, Math.round(v * 100)));

function entry(
  id: string,
  reason: CommandRejectReason | undefined,
  extra: Partial<FurnitureActionView> = {},
  run?: () => CommandRejectReason | undefined,
): Act {
  const a: Act = { id, labelPl: furnitureActionPl(id), enabled: !reason, ...extra };
  if (reason) {
    a.reason = reason as FurnitureReason;
    a.reasonPl ??= furnitureReasonPl(reason);
  }
  if (!reason && run) a.run = run;
  return a;
}

/** A timed action: validation + duration from its handler (`previewAction`). */
function timed(
  w: SimWorld,
  eid: number,
  id: string,
  a: ActionState,
  extra: Partial<FurnitureActionView> = {},
): Act {
  const p = previewAction(w, eid, a);
  const dur =
    p.durationMin !== undefined ? { durationMin: Math.round(p.durationMin * 1000) / 1000 } : {};
  return entry(id, p.reason, { ...dur, ...extra }, () => startAction(w, eid, a));
}

const header = (cmd: UseFurnitureCommand) => ({
  tick: cmd.tick,
  playerId: cmd.playerId,
  seq: cmd.seq,
});

// ── Edges: doors, gates, windows ───────────────────────────────────────────────────────────

function edgeActions(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  key: number,
  kind: number,
  cmd?: UseFurnitureCommand,
): Act[] {
  const o = w.openings;
  const k = unpackKey(key);
  const e = o.states.get(key);
  const state = currentState(o, key);
  const planks = e?.planks ?? 0;
  const out: Act[] = [];
  const toggle = (lock: boolean) => () =>
    applyOpeningCommand(w, grid, eid, {
      ...(cmd ? header(cmd) : { tick: w.tick, playerId: 0, seq: 0 }),
      type: 'toggleDoor',
      tx: k.tx,
      ty: k.ty,
      side: k.side,
      ...(lock ? { lock: true } : {}),
    });
  const blocked: CommandRejectReason | undefined =
    planks > 0 || state === OS.barricaded || state === OS.broken ? 'invalid-state' : undefined;
  const edgeAct = (kindName: Parameters<typeof newAction>[0], method?: ActionState['method']) => {
    const a = newAction(kindName, { edge: key });
    if (method) a.method = method;
    return a;
  };
  const cfg = o.cfg;
  // Open / close (a locked door says so).
  if (state === OS.open) out.push(entry('close', blocked, {}, toggle(false)));
  else
    out.push(
      entry('open', blocked ?? (state === OS.locked ? 'locked' : undefined), {}, toggle(false)),
    );
  if (isDoorLike(kind)) {
    const inside = insideOf(w, eid, key);
    if (state === OS.locked) {
      if (inside) out.push(entry('unlock', blocked, {}, toggle(true)));
      else out.push(timed(w, eid, 'unlock-key', edgeAct('useKey', 'unlock')));
      const picks = carriedLockpicks(w, eid);
      const lp = cfg.locks?.lockpick;
      const chance = lockpickChance(w, eid);
      const odds = lp
        ? { chancePct: pct(chance), breakChancePct: pct((1 - chance) * lp.breakChance) }
        : {};
      if (picks.length === 0) out.push(entry('lockpick', 'missing-item', odds));
      for (const item of picks) {
        const a = newAction('pickLock', { edge: key, item: item.id });
        out.push(
          timed(w, eid, `lockpick:${item.id}`, a, {
            ...odds,
            noiseTiles: lp?.noise.radiusTiles ?? 0,
            item: { id: item.id, def: defOf(w.items!, item).id },
          }),
        );
      }
      const f = cfg.force;
      const str = skillLevel(w, eid, f.strengthSkill) * f.chancePerStrength;
      const pry = timed(w, eid, 'force-pry', edgeAct('forceDoor', 'pry'), {
        chancePct: pct(f.pryChance + str),
        noiseTiles: f.pryNoise.radiusTiles,
      });
      if (pry.reason === 'missing-tool') pry.reasonPl = 'Brak łomu';
      out.push(pry);
      out.push(
        timed(w, eid, 'force-kick', edgeAct('forceDoor', 'kick'), {
          chancePct: pct(f.kickChance + str),
          noiseTiles: f.kickNoise.radiusTiles,
        }),
      );
    } else if (state === OS.closed) {
      if (inside) out.push(entry('lock', blocked, {}, toggle(true)));
      else out.push(timed(w, eid, 'lock-key', edgeAct('useKey', 'lock')));
    }
    if (state !== OS.open && state !== OS.broken)
      out.push(
        entry(
          'knock',
          edgeInReach(w, eid, key) ? undefined : 'out-of-range',
          {
            noiseTiles: cfg.locks?.knockNoise.radiusTiles ?? 6,
          },
          () => knock(w, eid, key),
        ),
      );
  } else if (kind === OpeningKind.window) {
    if (state === OS.closed || state === OS.open) {
      const bare = !playerItems(w, eid)?.slots.get('hand_primary');
      out.push(
        timed(w, eid, 'smash', edgeAct('smashWindow'), {
          noiseTiles: cfg.breakNoise.radiusTiles,
          ...(bare ? { injuryChancePct: pct(cfg.window.handCutChance) } : {}),
        }),
      );
    }
    if (state === OS.broken && !e?.cleared)
      out.push(
        timed(w, eid, 'clear-glass', edgeAct('removeGlass'), {
          ...(!wearsGloves(w, eid)
            ? { injuryChancePct: pct(cfg.window.clearGlassCutChance ?? 0) }
            : {}),
        }),
      );
    // Climbing through: open or smashed (with glass left: injury chance); closed = greyed out.
    const boarded = planks > 0 || state === OS.barricaded;
    if (state === OS.open || state === OS.broken) {
      const climb = timed(w, eid, 'climb-through', edgeAct('climbThrough'), {
        durationMin:
          Math.round((w.physics.cfg.vault.windowTicks / ticksPerGameMinute(w.clock)) * 1000) / 1000,
        ...(state === OS.broken && !e?.cleared
          ? { injuryChancePct: pct(w.physics.cfg.vault.glassChance) }
          : {}),
      });
      if (climb.reason === 'invalid-state' && boarded) climb.reasonPl = 'Okno zabite deskami';
      out.push(climb);
    } else {
      out.push(
        entry('climb-through', 'invalid-state', {
          reasonPl: boarded ? 'Okno zabite deskami' : 'Okno zamknięte',
        }),
      );
    }
  }
  // Curtains (every window, docs 9.53): hide the light inside from zombies.
  if (kind === OpeningKind.window) {
    const drawn = o.curtains.has(key);
    out.push(
      entry(
        drawn ? 'open-curtains' : 'close-curtains',
        edgeInReach(w, eid, key) ? undefined : 'out-of-range',
        {},
        () => {
          setCurtains(w, key, !drawn);
          return undefined;
        },
      ),
    );
  }
  // Barricade (doors closed / locked, windows, gates) and pulling planks.
  if (
    planks < cfg.barricade.maxPlanks &&
    !(isDoorLike(kind) && (state === OS.open || state === OS.broken))
  ) {
    const b = timed(w, eid, 'barricade', edgeAct('barricade'), {
      noiseTiles: cfg.barricade.noise.radiusTiles,
    });
    if (b.reason === 'missing-tool') b.reasonPl = 'Brak młotka';
    out.push(b);
  }
  if (planks > 0) out.push(timed(w, eid, 'unbarricade', edgeAct('removeBarricade')));
  return out;
}

// ── Map objects: storage, TV ───────────────────────────────────────────────────────────────

interface MapObj {
  contentId: string;
  x: number;
  y: number;
  z: number;
  n: number;
  rot?: number | undefined;
}

function objectActions(
  w: SimWorld,
  eid: number,
  obj: MapObj,
  cmd?: UseFurnitureCommand,
): { typeId: string; actions: Act[] } | undefined {
  const st = w.items;
  if (!st) return undefined;
  const out: Act[] = [];
  let typeId: string | undefined;
  // Storage: this object's containers on its tile (main type first, then compartments).
  const types = storageTypesOf(st, obj.contentId);
  if (types.length > 0) {
    const onTile = st.worldByTile.get(tileKey(obj.x, obj.y, obj.z)) ?? [];
    let skip = 0;
    for (const o of objectsOnTile(w, obj.x, obj.y, obj.z).slice(0, obj.n))
      skip += storageTypesOf(st, o.contentId).length;
    const ids = onTile.slice(skip, skip + types.length);
    ids.forEach((cid, i) => {
      const c = st.containers.get(cid);
      if (!c) return;
      const t = st.content.containerTypes[c.type]!;
      if (i === 0) typeId = t.category;
      // Not searched yet by this player: the same entry runs the timed search first.
      const searched = canReach(w, eid, cid);
      const open = () =>
        applyItemCommand(w, eid, {
          ...(cmd ? header(cmd) : { tick: w.tick, playerId: 0, seq: 0 }),
          ...(searched
            ? { type: 'openContainer' as const, container: cid }
            : { type: 'search' as const, container: cid }),
        });
      const reason = searched || containerInReach(w, eid, c) ? undefined : 'out-of-range';
      const id = i === 0 ? 'open-storage' : `open-storage:${cid}`;
      const a = entry(id, reason, searched ? {} : { durationMin: searchSecMin(w) }, open);
      if (!searched) a.labelPl = 'Przeszukaj';
      if (i > 0)
        a.labelPl = `${searched ? 'Otwórz' : 'Przeszukaj'}: ${t.category === 'freezer' ? 'zamrażarka' : t.category}`;
      out.push(a);
    });
  }
  // TV: watch, insert a tape.
  const def = st.content.items[st.content.itemIndex.get(obj.contentId) ?? -1];
  const tvTag = w.survival?.content.survival.leisure.tvTag ?? 'base:station-tv';
  if (def?.kind === 'placeable' && def.placeable.power && def.tags.includes(tvTag)) {
    typeId ??= 'tv';
    out.push(timed(w, eid, 'watch', newAction('watch', { item: 0 })));
    const carried = tapes(w, eid);
    for (const item of carried) {
      out.push(
        timed(w, eid, `insert-tape:${item.id}`, newAction('watch', { item: item.id }), {
          item: { id: item.id, def: defOf(st, item).id },
        }),
      );
    }
    // No tape carried: a grey entry says why.
    if (carried.length === 0) out.push(entry('insert-tape', 'missing-item'));
  }
  // Radio set: listen; VCR: play a carried tape (the TV next to it shows it).
  const leisure = w.survival?.content.survival.leisure;
  if (def?.kind === 'placeable' && leisure && def.tags.includes(leisure.radioTag)) {
    typeId ??= 'radio';
    out.push(timed(w, eid, 'listen-radio', newAction('listen')));
  }
  if (def?.kind === 'placeable' && leisure && def.tags.includes(leisure.vcrTag)) {
    typeId ??= 'vcr';
    const carried = tapes(w, eid);
    if (carried.length === 0) out.push(entry('watch-vhs', 'missing-item'));
    for (const item of carried)
      out.push(
        timed(w, eid, `watch-vhs:${item.id}`, newAction('watch', { item: item.id }), {
          item: { id: item.id, def: defOf(st, item).id },
        }),
      );
  }
  // Bed / sofa: sleep (until rested, until morning, `sleep-until:<hours>`); seats: rest.
  if (def?.kind === 'placeable' && (def.placeable.sleepSurface || def.placeable.seat)) {
    typeId ??= def.placeable.sleepSurface ?? 'seat';
    if (def.placeable.sleepSurface) {
      const reason = sleepReason(w, eid);
      const sleep = (until?: 'morning' | number) => () => {
        const r = fallAsleep(w, eid, until);
        return r === 'ok' ? undefined : r;
      };
      out.push(entry('sleep', reason, {}, sleep()));
      out.push(entry('sleep-until:morning', reason, {}, sleep('morning')));
      // Offered alarms (protocol 34): `SLEEP_UNTIL_HOURS` up to `sleep.untilMaxHours`; any other
      // `sleep-until:<1..24>` still runs when the client sends it.
      const maxH = w.survival?.content.survival.sleep.untilMaxHours ?? 24;
      const hours: number[] = SLEEP_UNTIL_HOURS.filter((x) => x <= maxH);
      const h = cmd?.actionId.startsWith('sleep-until:') ? Number(cmd.actionId.slice(12)) : NaN;
      if (Number.isInteger(h) && h >= 1 && h <= 24 && !hours.includes(h)) hours.push(h);
      for (const x of hours) out.push(entry(`sleep-until:${x}`, reason, {}, sleep(x)));
    }
    out.push(timed(w, eid, 'rest', newAction('rest')));
    // Read a carried book / magazine sitting here.
    const p = playerItems(w, eid);
    const seen = new Set<number>();
    for (const item of p ? carriedItems(st, p.inventory) : []) {
      if (defOf(st, item).kind !== 'literature' || seen.has(item.def)) continue;
      seen.add(item.def);
      out.push(
        timed(w, eid, `read:${item.id}`, newAction('read', { item: item.id }), {
          item: { id: item.id, def: defOf(st, item).id },
        }),
      );
    }
  }
  // Mains water (docs 9.54): sink / washbasin (drink, wash), shower, bath.
  const hy = w.survival?.content.survival.hygiene;
  if (hy) {
    const water = (id: string, use: WaterUse) => out.push(timed(w, eid, id, waterAction(use)));
    if (objectHasTag(w, obj.contentId, hy.tapTag)) {
      typeId = 'sink';
      water('drink-tap', 'drink');
      water('wash', 'wash');
    }
    if (objectHasTag(w, obj.contentId, hy.showerTag)) {
      typeId ??= 'shower';
      water('shower', 'shower');
    }
    if (objectHasTag(w, obj.contentId, hy.bathTag)) {
      typeId ??= 'bath';
      water('bath', 'bath');
    }
  }
  // Light switch: turns the powered lamps of its room on / off (docs 9.53).
  if (def && def.tags.includes(st.content.lighting.switchTag)) {
    typeId ??= 'light-switch';
    const key = switchKeyOf(obj.x, obj.y, obj.z);
    const on = w.openings.lightsOn.has(key);
    out.push(
      entry(on ? 'light-off' : 'light-on', undefined, {}, () => {
        setLight(w, key, !on);
        return undefined;
      }),
    );
  }
  // Stove: one `cook:<recipeId>` per known recipe of its station (parts it has, level it allows).
  if (def?.kind === 'placeable' && def.placeable.cooking && def.placeable.station) {
    typeId ??= 'stove';
    const at = def.placeable.station;
    const stove = {
      ...at,
      x: obj.x,
      y: obj.y,
      z: obj.z,
      item: undefined,
      cooking: def.placeable.cooking,
    };
    const src = craftSources(w, eid);
    st.content.recipes.forEach((r, ri) => {
      const rs = r.station;
      if (!rs || rs.id !== at.id || rs.minLevel > at.level) return;
      if (rs.appliance && !stove.cooking[rs.appliance]) return;
      const ev = evalRecipe(w, eid, ri, src);
      if (ev.state === 'notLearned' || ev.state === 'skillLocked') return;
      const id = `cook:${r.id}`;
      // Dish name (protocol 34): the first result item's Polish name, the submenu is "Gotuj".
      const dish = { labelPl: dishNamePl(w, r), recipe: r.id };
      out.push(
        stationHeats(st, stove, rs.appliance)
          ? timed(w, eid, id, newAction('craft', { recipe: ri + 1, use: [] }), dish)
          : entry(id, 'no-power', { durationMin: ev.durationMin, ...dish }),
      );
    });
  }
  if (!typeId || out.length === 0) return undefined;
  return { typeId, actions: out };
}

/** Carried VHS tapes (one per kind). */
function tapes(w: SimWorld, eid: number) {
  const st = w.items!;
  const p = playerItems(w, eid);
  const seen = new Set<number>();
  return (p ? carriedItems(st, p.inventory) : []).filter((i) => {
    if (defOf(st, i).kind !== 'vhs' || seen.has(i.def)) return false;
    seen.add(i.def);
    return true;
  });
}

function objectsOnTile(w: SimWorld, x: number, y: number, z: number): MapObj[] {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const out: MapObj[] = [];
  for (const o of w.map.getChunk(cx, cy, z)?.objects ?? []) {
    if (cx * CHUNK_SIZE + o.x !== x || cy * CHUNK_SIZE + o.y !== y) continue;
    out.push({ contentId: o.contentId, x, y, z, n: out.length, rot: o.rot });
  }
  return out;
}

// ── Menu ───────────────────────────────────────────────────────────────────────────────────

interface Candidate {
  id: number;
  x: number;
  y: number;
  z: number;
  build: (cmd?: UseFurnitureCommand) => (FurnitureView & { acts: Act[] }) | undefined;
}

function candidates(w: SimWorld, grid: TileGrid, eid: number): Candidate[] {
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const r = w.openings.cfg.reachTiles;
  const out: Candidate[] = [];
  // Furniture footprint: pieces anchored up to 3 tiles further NW can still be in reach.
  const back = w.furniture ? 3 : 0;
  for (let ty = Math.floor(py - r) - 1 - back; ty <= Math.floor(py + r) + 1; ty++) {
    for (let tx = Math.floor(px - r) - 1 - back; tx <= Math.floor(px + r) + 1; tx++) {
      for (const side of [0, 1]) {
        const key = openingKey(side, tx, ty, z);
        const kind = edgeKindOf(w.openings, key);
        if (kind !== OpeningKind.door && kind !== OpeningKind.window && kind !== OpeningKind.gate)
          continue;
        if (!edgeInReach(w, eid, key)) continue;
        const c = edgeCentre(side, tx, ty);
        const typeId =
          kind === OpeningKind.door ? 'door' : kind === OpeningKind.gate ? 'gate' : 'window';
        out.push({
          id: key,
          x: c.x,
          y: c.y,
          z,
          build: (cmd) => {
            const acts = edgeActions(w, grid, eid, key, kind, cmd);
            return { furnitureId: key, typeId, x: c.x, y: c.y, z, actions: acts, acts };
          },
        });
      }
      const dx = tx + 0.5 - px;
      const dy = ty + 0.5 - py;
      if (!w.furniture && dx * dx + dy * dy > r * r) continue;
      for (const obj of objectsOnTile(w, tx, ty, z)) {
        const id = objectFurnitureId(tx, ty, z, obj.n);
        // Footprint: reach from any tile next to the piece, entry at the footprint centre.
        let ox = tx + 0.5;
        let oy = ty + 0.5;
        if (w.furniture) {
          const rect = objectRect(w, tx, ty, obj.contentId, obj.rot);
          if (rectDist2(rect, px, py) > r * r) continue;
          ox = tx + rect.w / 2;
          oy = ty + rect.h / 2;
        }
        out.push({
          id,
          x: ox,
          y: oy,
          z,
          build: (cmd) => {
            const m = objectActions(w, eid, obj, cmd);
            if (!m) return undefined;
            return {
              furnitureId: id,
              typeId: m.typeId,
              contentId: obj.contentId,
              x: ox,
              y: oy,
              z,
              actions: m.actions,
              acts: m.actions,
            };
          },
        });
      }
    }
  }
  // Nearest to the aim point (or the player) first; ties by id.
  const { AimIntent } = w.c;
  const ax = AimIntent.active[eid] ? (AimIntent.x[eid] ?? px) : px;
  const ay = AimIntent.active[eid] ? (AimIntent.y[eid] ?? py) : py;
  const d = (c: Candidate) => (c.x - ax) * (c.x - ax) + (c.y - ay) * (c.y - ay);
  return out.sort((a, b) => d(a) - d(b) || a.id - b.id);
}

/** Real seconds at ×1 of `durationMin` game minutes (0.1 s). */
const realSec = (w: SimWorld, min: number): number =>
  Math.round(((min * ticksPerGameMinute(w.clock)) / TICKS_PER_SECOND) * 10) / 10;

const strip = (w: SimWorld, acts: Act[]): FurnitureActionView[] =>
  acts.map((a) => {
    const { run, ...view } = a;
    void run;
    if (view.reasonPl === undefined) delete view.reasonPl;
    if (view.durationMin !== undefined) view.durationSec = realSec(w, view.durationMin);
    return view;
  });

/** `SimViewPatch.furnitureActions` for player `eid` (empty when dead / asleep / no items). */
export function furnitureActionsView(w: SimWorld, grid: TileGrid, eid: number): FurnitureView[] {
  if (!w.items || w.survival?.dead[eid]) return [];
  const out: FurnitureView[] = [];
  for (const c of candidates(w, grid, eid)) {
    const v = c.build();
    if (!v || v.acts.length === 0) continue;
    const { acts, ...rest } = v;
    out.push({ ...rest, actions: strip(w, acts) });
    if (out.length >= MAX_FURNITURE_ENTRIES) break;
  }
  return out;
}

/** `useFurniture {furnitureId, actionId}`: rebuilds the entry and runs the action. */
export function applyUseFurniture(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  cmd: UseFurnitureCommand,
): CommandRejectReason | undefined {
  if (!w.items || !playerItems(w, eid)) return 'invalid-state';
  if (w.survival?.asleep[eid]) return 'invalid-state';
  const c = candidates(w, grid, eid).find((x) => x.id === cmd.furnitureId);
  if (!c) return 'out-of-range';
  const v = c.build(cmd);
  const a = v?.acts.find((x) => x.id === cmd.actionId);
  if (!a) return 'invalid-target';
  if (!a.enabled) return a.reason ?? 'invalid-state';
  return a.run?.();
}
