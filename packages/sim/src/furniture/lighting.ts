import { emitNoise } from '../ai/noise.js';
import { sunState } from '../ai/sky.js';
import { roomSig } from '../ai/state.js';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { edgeKindOf, OpeningKind, openingKey } from '../openings/state.js';

/**
 * Room lighting (docs 9.53): light switches (`lighting.switchTag` map objects) turn the powered
 * lamps of their room on and off (`OpeningsWorld.lightsOn`, `StaticLight.switchKey`), curtains are
 * drawn per window (`OpeningsWorld.curtains`). At night (sky ≤ `lure.maxSky`) every window of a
 * room with a switched-on lamp, curtains open and not fully boarded, is a `light` stimulus outside
 * it (`emitNoise`, radius `lure.radiusTiles`): zombies come to look, sleepers do not wake.
 */

export function setLight(w: SimWorld, key: number, on: boolean): void {
  const o = w.openings;
  if (o.lightsOn.has(key) === on) return;
  if (on) o.lightsOn.add(key);
  else o.lightsOn.delete(key);
  o.version++;
}

export function setCurtains(w: SimWorld, edge: number, closed: boolean): void {
  const o = w.openings;
  if (o.curtains.has(edge) === closed) return;
  if (closed) o.curtains.add(edge);
  else o.curtains.delete(edge);
  o.version++;
}

/** Lamp of a room is lit: power (when it needs it) and its switch on (when it has one). */
export function lampLit(w: SimWorld, l: { requiresPower: boolean; switchKey: number }): boolean {
  if (l.requiresPower && !(w.items?.powered ?? true)) return false;
  return l.switchKey < 0 || w.openings.lightsOn.has(l.switchKey);
}

/** Most tiles from a lamp searched for windows of its room. */
const WINDOW_SCAN_TILES = 8;

/**
 * Windows leaking light now: outside tile centre of each window of a room lit by a switched-on
 * lamp (curtains open, fewer planks than `barricade.maxPlanks`). Deduplicated, in lamp order.
 */
export interface LitWindow {
  key: number;
  /** Outside tile centre (the lure point). */
  x: number;
  y: number;
  z: number;
  /** Middle of the window edge (the glow, `SimViewPatch.litWindows`). */
  wx: number;
  wy: number;
  /** Share of the light let out (window cover `lightPass`, docs 9.78; 1 = uncovered). */
  pass: number;
}

export function litWindows(w: SimWorld): LitWindow[] {
  const ai = w.ai;
  const o = w.openings;
  const out: LitWindow[] = [];
  if (!ai || o.lightsOn.size === 0) return out;
  const seen = new Set<number>();
  const map = o.map;
  for (const l of ai.lights) {
    if (l.switchKey < 0 || !lampLit(w, l)) continue;
    const z = l.z;
    const lx = Math.floor(l.x);
    const ly = Math.floor(l.y);
    const room = roomSig(map, lx, ly, z);
    if (!room) continue;
    const r = Math.min(WINDOW_SCAN_TILES, Math.ceil(l.radius));
    for (let ty = ly - r; ty <= ly + r; ty++) {
      for (let tx = lx - r; tx <= lx + r; tx++) {
        if (roomSig(map, tx, ty, z) !== room) continue;
        const edges: [number, number, number, number, number][] = [
          [openingKey(0, tx, ty, z), tx, ty - 1, tx + 0.5, ty],
          [openingKey(0, tx, ty + 1, z), tx, ty + 1, tx + 0.5, ty + 1],
          [openingKey(1, tx, ty, z), tx - 1, ty, tx, ty + 0.5],
          [openingKey(1, tx + 1, ty, z), tx + 1, ty, tx + 1, ty + 0.5],
        ];
        for (const [key, ox, oy, wx, wy] of edges) {
          if (seen.has(key) || o.curtains.has(key)) continue;
          if (edgeKindOf(o, key) !== OpeningKind.window) continue;
          if (roomSig(map, ox, oy, z) !== undefined) continue;
          if ((o.states.get(key)?.planks ?? 0) >= o.cfg.barricade.maxPlanks) continue;
          // Window cover (docs 9.78): `lightPass` 0 hides the lamp completely.
          const pass = o.covers.get(key)?.lightPass ?? 1;
          if (pass <= 0) continue;
          seen.add(key);
          out.push({ key, x: ox + 0.5, y: oy + 0.5, z, wx, wy, pass });
        }
      }
    }
  }
  return out;
}

/** Pipeline `lightLure` (after `light`): lit windows at night lure zombies, once per think cycle. */
export function lightLureSystem(w: SimWorld): void {
  const ai = w.ai;
  const lure = w.items?.content.lighting.lure;
  if (!ai || !lure?.enabled || w.openings.lightsOn.size === 0) return;
  if (w.tick % Math.max(1, ai.cfg.ai.farThinkEveryTicks) !== 0) return;
  if (sunState(gameMinuteAt(w.clock, w.tick)).sky > lure.maxSky) return;
  for (const win of litWindows(w))
    emitNoise(
      w,
      win.x,
      win.y,
      win.z,
      lure.radiusTiles * win.pass,
      lure.volume * win.pass,
      'light',
      lure.lingerSec,
    );
}
