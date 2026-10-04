/* eslint-disable no-restricted-properties, no-restricted-globals -- drawing math (cos / sin / hypot) for the debug picture and the DZ_SHOTS env switch, not sim state. */
import type { SimEdgeKind, SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import type { Sim, VehicleInfo } from '../sim.js';
import { eventsOf } from '../test/ai-fixtures.js';
import type { MapSpec } from '../test/fixtures.js';
import { Canvas, nodeDeflate, writeFileIfNode, type Rgb } from '../test/topdown.js';
import { car, seatedSim, SEDAN, type VehicleSimOptions } from '../test/vehicle-fixtures.js';

/**
 * Headless top-down debug renders of the driving model (path, car boxes, zombies, hit points).
 * Always rendered and checked; written as PNG only when `DZ_SHOTS` names a directory:
 * `DZ_SHOTS=/workspace/deadzone-shots pnpm --filter @deadzone/sim exec vitest run debug-render`.
 */
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const OUT = env?.DZ_SHOTS;

const TPS = 20;
const WHITE: Rgb = [235, 235, 235];
const GREY: Rgb = [120, 124, 130];
const DIM: Rgb = [55, 58, 64];
const GREEN: Rgb = [90, 200, 110];
const YELLOW: Rgb = [240, 210, 70];
const ORANGE: Rgb = [245, 140, 50];
const RED: Rgb = [230, 60, 60];
const BLUE: Rgb = [80, 150, 240];
const CYAN: Rgb = [90, 220, 230];

/** Speed colour: blue (0) → green → yellow → red (≥ `max` m/s). */
function speedColour(v: number, max = 15): Rgb {
  const t = Math.max(0, Math.min(1, Math.abs(v) / max));
  const stops: Rgb[] = [BLUE, GREEN, YELLOW, RED];
  const s = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(s));
  const k = s - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

interface View {
  cv: Canvas;
  x0: number;
  y0: number;
  s: number;
  ox: number;
  oy: number;
}
const P = (v: View, x: number, y: number): [number, number] => [
  v.ox + (x - v.x0) * v.s,
  v.oy + (y - v.y0) * v.s,
];

function grid(v: View, x1: number, y1: number, every = 5): void {
  for (let x = Math.ceil(v.x0 / every) * every; x <= x1; x += every) {
    const [a, b] = P(v, x, v.y0);
    const [, d] = P(v, x, y1);
    v.cv.line(a, b, a, d, x % 10 === 0 ? [44, 47, 53] : [34, 36, 41]);
  }
  for (let y = Math.ceil(v.y0 / every) * every; y <= y1; y += every) {
    const [a, b] = P(v, v.x0, y);
    const [c] = P(v, x1, y);
    v.cv.line(a, b, c, b, y % 10 === 0 ? [44, 47, 53] : [34, 36, 41]);
  }
}

function carBox(v: View, c: { x: number; y: number; headingRad: number }, col: Rgb, w = 1): void {
  const hx = Math.cos(c.headingRad);
  const hy = Math.sin(c.headingRad);
  const hl = SEDAN.length / 2;
  const hw = SEDAN.width / 2;
  const pts = (
    [
      [hl, -hw],
      [hl, hw],
      [-hl, hw],
      [-hl, -hw],
    ] as const
  ).map(([l, s]) => P(v, c.x + hx * l - hy * s, c.y + hy * l + hx * s));
  v.cv.poly(pts, col, w);
  // Nose marker.
  const [nx, ny] = P(v, c.x + hx * hl, c.y + hy * hl);
  v.cv.disc(nx, ny, w + 1, col);
}

function cross(v: View, x: number, y: number, col: Rgb, r = 6, w = 2): void {
  const [px, py] = P(v, x, y);
  v.cv.line(px - r, py - r, px + r, py + r, col, w);
  v.cv.line(px - r, py + r, px + r, py - r, col, w);
}

function path(
  v: View,
  pts: readonly { x: number; y: number; speed: number }[],
  w = 3,
  max = 15,
): void {
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = P(v, pts[i - 1]!.x, pts[i - 1]!.y);
    const [c, d] = P(v, pts[i]!.x, pts[i]!.y);
    v.cv.line(a, b, c, d, speedColour(pts[i]!.speed, max), w);
  }
}

function legendSpeed(cv: Canvas, x: number, y: number, max: number): void {
  cv.text(x, y, 'SPEED', GREY, 2);
  for (let i = 0; i < 160; i++) cv.rect(x + 60 + i, y, 1, 10, speedColour((i / 159) * max, max));
  cv.text(x + 60, y + 14, '0', GREY, 2);
  cv.text(x + 190, y + 14, `${Math.round(max * 3.6)} KM/H`, GREY, 2);
}

async function save(name: string, cv: Canvas): Promise<void> {
  const png = cv.png(await nodeDeflate());
  expect([...png.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
  if (OUT) await writeFileIfNode(`${OUT}/${name}`, png);
}

type Sample = VehicleInfo & { t: number };
function record(sim: Sim, out: Sample[], events: SimEvent[]): void {
  sim.step();
  out.push({ ...car(sim), t: sim.tick / TPS });
  events.push(...sim.drainEvents());
}

describe('vehicles: top-down debug renders', () => {
  it('fiz-car-accel.png: 0–50 km/h and full brake to a stop', async () => {
    const { sim, ctl } = seatedSim({ car: { x: 20, y: 64 } });
    const pts: Sample[] = [];
    const ev: SimEvent[] = [];
    const t0 = sim.tick;
    ctl.drive(1);
    while (car(sim).speed < 50 / 3.6 && pts.length < 400) record(sim, pts, ev);
    const reach = pts[pts.length - 1]!;
    ctl.drive(0, 1);
    while (car(sim).speed > 0.02 && pts.length < 800) record(sim, pts, ev);
    ctl.drive(0);
    for (let i = 0; i < 10; i++) record(sim, pts, ev);
    const stop = pts[pts.length - 1]!;
    const t50 = (reach.t - t0 / TPS).toFixed(1);
    const brakeM = (stop.x - reach.x).toFixed(1);
    expect(Number(t50)).toBeGreaterThan(2);
    expect(Number(brakeM)).toBeGreaterThan(8);

    const W = 1200;
    const cv = new Canvas(W, 640);
    const v: View = { cv, x0: 14, y0: 56, s: (W - 40) / (stop.x + 8 - 14), ox: 20, oy: 70 };
    grid(v, stop.x + 8, 72);
    cv.text(20, 16, 'FIZYKA AUTA: PRZYSPIESZANIE I HAMOWANIE (SEDAN 1200 KG, 90 KW)', WHITE, 3);
    cv.text(
      20,
      44,
      `0-50 KM/H: ${t50} S (${(reach.x - 20).toFixed(1)} M)   HAMOWANIE 50-0: ${brakeM} M   GRID 5 M`,
      GREY,
      2,
    );
    for (let i = 0; i < pts.length; i += 10) carBox(v, pts[i]!, DIM);
    path(v, pts, 4);
    carBox(v, reach, YELLOW, 2);
    carBox(v, stop, WHITE, 2);
    const [rx, ry] = P(v, reach.x, reach.y);
    cv.text(rx - 40, ry - 70, '50 KM/H', YELLOW, 2);
    cv.text(rx - 40, ry - 52, 'HAMULEC', YELLOW, 2);
    const [sx, sy] = P(v, stop.x, stop.y);
    cv.text(sx - 30, sy + 40, 'STOP', WHITE, 2);
    legendSpeed(cv, W - 300, 44, 15);

    // Speed / time plot.
    const px0 = 80;
    const py0 = 600;
    const ph = 260;
    const tMax = stop.t - t0 / TPS;
    const pw = W - 120;
    for (let k = 0; k <= 60; k += 10) {
      const y = py0 - (k / 60) * ph;
      cv.line(px0, y, px0 + pw, y, k === 0 ? GREY : DIM);
      cv.text(px0 - 44, y - 5, `${k}`, GREY, 2);
    }
    for (let s = 0; s <= tMax; s++) {
      const x = px0 + (s / tMax) * pw;
      cv.line(x, py0, x, py0 - ph, DIM);
      cv.text(x - 4, py0 + 10, `${s}`, GREY, 2);
    }
    cv.text(px0 - 44, py0 - ph - 22, 'KM/H', GREY, 2);
    cv.text(px0 + pw - 10, py0 + 26, 'S', GREY, 2);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      cv.line(
        px0 + ((a.t - t0 / TPS) / tMax) * pw,
        py0 - ((a.speed * 3.6) / 60) * ph,
        px0 + ((b.t - t0 / TPS) / tMax) * pw,
        py0 - ((b.speed * 3.6) / 60) * ph,
        speedColour(b.speed),
        3,
      );
    }
    await save('fiz-car-accel.png', cv);
  });

  it('fiz-car-drift.png: full lock at 54 km/h, with and without the handbrake', async () => {
    const run = (handbrake: boolean) => {
      const { sim, ctl } = seatedSim({ car: { x: 20, y: 30 } });
      const pts: Sample[] = [];
      const ev: SimEvent[] = [];
      ctl.drive(1);
      while (car(sim).speed < 15 && pts.length < 400) record(sim, pts, ev);
      const start = pts.length;
      ctl.drive(0, 0, 1, handbrake);
      for (let i = 0; i < 24; i++) record(sim, pts, ev);
      ctl.drive(0.3, 0, 1, false);
      for (let i = 0; i < 36; i++) record(sim, pts, ev);
      const maxSlip = Math.max(...pts.slice(start).map((p) => p.slip));
      return { pts, start, maxSlip };
    };
    const grip = run(false);
    const drift = run(true);
    expect(drift.maxSlip).toBeGreaterThan(grip.maxSlip);

    const all = [...grip.pts, ...drift.pts].slice(0);
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const x0 = Math.min(...xs) - 6;
    const x1 = Math.max(...xs) + 6;
    const y0 = Math.min(...ys) - 6;
    const y1 = Math.max(...ys) + 6;
    const W = 1200;
    const s = Math.min((W - 40) / (x1 - x0), 560 / (y1 - y0));
    const cv = new Canvas(W, Math.ceil((y1 - y0) * s) + 110);
    const v: View = { cv, x0, y0, s, ox: 20, oy: 90 };
    grid(v, x1, y1);
    cv.text(20, 16, 'POSLIZG: PELNY SKRET PRZY 54 KM/H', WHITE, 3);
    cv.text(
      20,
      44,
      `NIEBIESKI: BEZ RECZNEGO (MAX SLIP ${grip.maxSlip.toFixed(2)})   POMARANCZOWY: RECZNY 1.2 S (MAX SLIP ${drift.maxSlip.toFixed(2)})`,
      GREY,
      2,
    );
    cv.text(
      20,
      64,
      'RAMKA = AUTO CO 0.2 S, BIALA KRESKA = KIERUNEK PREDKOSCI (ROZJAZD Z NOSEM = POSLIZG)',
      GREY,
      2,
    );
    for (const [r, col] of [
      [grip, BLUE],
      [drift, ORANGE],
    ] as const) {
      for (let i = 1; i < r.pts.length; i++) {
        const [a, b] = P(v, r.pts[i - 1]!.x, r.pts[i - 1]!.y);
        const [c, d] = P(v, r.pts[i]!.x, r.pts[i]!.y);
        cv.line(a, b, c, d, col, 2, 0.6);
      }
      for (let i = r.start; i < r.pts.length; i += 4) {
        const p = r.pts[i]!;
        carBox(v, p, col, 1);
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 0.5) {
          const [a, b] = P(v, p.x, p.y);
          cv.arrow(a, b, a + (p.vx / sp) * 3 * s, b + (p.vy / sp) * 3 * s, WHITE, 1);
        }
      }
      carBox(v, r.pts[r.start]!, GREEN, 2);
    }
    const [gx, gy] = P(v, grip.pts[grip.start]!.x, grip.pts[grip.start]!.y);
    cv.text(gx - 60, gy - 40, 'SKRET', GREEN, 2);
    await save('fiz-car-drift.png', cv);
  });

  it('fiz-car-ram.png: zombies at 2.5 / 5.5 / 8 / 11 m/s, a fence and a wall', async () => {
    const column = (kind: 'wall' | 'fence'): MapSpec => ({
      wallW: (x) => x === 60,
      edgeId: () => (kind === 'fence' ? 2 : 1),
      edgeKinds: [null, 'wall', 'fence'] as (SimEdgeKind | null)[],
    });
    const lanes: {
      speed: number;
      label: string;
      opts: VehicleSimOptions;
      wall?: 'wall' | 'fence';
    }[] = [
      { speed: 2.5, label: 'ZOMBIE', opts: { zombies: [{ x: 45, y: 64, type: 'fixture:dummy' }] } },
      { speed: 5.5, label: 'ZOMBIE', opts: { zombies: [{ x: 45, y: 64, type: 'fixture:dummy' }] } },
      { speed: 8, label: 'ZOMBIE', opts: { zombies: [{ x: 45, y: 64, type: 'fixture:dummy' }] } },
      { speed: 11, label: 'ZOMBIE', opts: { zombies: [{ x: 45, y: 64, type: 'fixture:dummy' }] } },
      { speed: 8, label: 'PLOT', opts: { map: column('fence') }, wall: 'fence' },
      { speed: 6, label: 'SCIANA', opts: { map: column('wall') }, wall: 'wall' },
    ];
    const W = 1200;
    const laneH = 120;
    const cv = new Canvas(W, 90 + lanes.length * laneH + 30);
    cv.text(20, 16, 'TARANOWANIE: PROG PREDKOSCI -> REAKCJA (ZOMBIE STOI W X = 45)', WHITE, 3);
    cv.text(
      20,
      44,
      'ZIELONE KOLO = START ZOMBIE, SZARA LINIA = JEGO TOR, BIALY X + STRZALKA = PUNKT I NORMALNA UDERZENIA',
      GREY,
      2,
    );
    cv.text(
      20,
      62,
      'ZOLTY = ZACHWIANIE, POMARANCZOWY = PRZEWROCENIE, CZERWONY X = SMIERC',
      GREY,
      2,
    );
    legendSpeed(cv, W - 300, 62, 12);
    lanes.forEach((lane, li) => {
      const { sim, ctl } = seatedSim(lane.opts);
      const zid = sim.getZombies()[0]?.stableId ?? 0;
      const pts: Sample[] = [];
      const zt: { x: number; y: number }[] = [];
      const ev: SimEvent[] = [];
      let cruise = true;
      const zStart = sim.getZombies()[0];
      for (let i = 0; i < 230; i++) {
        if (cruise && car(sim).x > (lane.wall ? 58 : 45)) {
          cruise = false;
          ctl.drive(0);
        } else if (cruise) ctl.drive(Math.max(0, Math.min(1, (lane.speed - car(sim).speed) * 2)));
        record(sim, pts, ev);
        const z = sim.getZombies()[0];
        if (z) zt.push({ x: z.x, y: z.y });
      }
      const v: View = { cv, x0: 14, y0: 64 - laneH / 2 / 14, s: 14, ox: 20, oy: 90 + li * laneH };
      cv.line(0, v.oy, W, v.oy, DIM);
      grid(v, 14 + (W - 40) / 14, 64 + laneH / 2 / 14);
      if (lane.wall) {
        const broken = eventsOf(ev, 'openingChanged').length > 0;
        const [a, b] = P(v, 60, 60);
        const [, d] = P(v, 60, 68);
        cv.line(
          a,
          b,
          a,
          d,
          lane.wall === 'wall' ? WHITE : broken ? [110, 80, 50] : [190, 140, 80],
          4,
          broken ? 0.5 : 1,
        );
      }
      for (let i = 0; i < pts.length; i += 10) carBox(v, pts[i]!, DIM);
      path(v, pts, 3, 12);
      carBox(v, pts[pts.length - 1]!, WHITE, 2);
      if (zStart) {
        const [zx, zy] = P(v, zStart.x, zStart.y);
        cv.ring(zx, zy, 5, GREEN, 2);
      }
      for (let i = 1; i < zt.length; i++) {
        const [a, b] = P(v, zt[i - 1]!.x, zt[i - 1]!.y);
        const [c, d] = P(v, zt[i]!.x, zt[i]!.y);
        cv.line(a, b, c, d, GREY, 2);
      }
      const phys = eventsOf(ev, 'physics').filter((e) => e.entity === zid);
      const died = phys.some((e) => e.kind === 'died');
      const fell = phys.some((e) => e.kind === 'fellDown');
      const stag = phys.some((e) => e.kind === 'staggered');
      const zEnd = zt[zt.length - 1];
      if (zEnd) {
        if (died) cross(v, zEnd.x, zEnd.y, RED, 7, 3);
        else {
          const [a, b] = P(v, zEnd.x, zEnd.y);
          cv.disc(a, b, 6, fell ? ORANGE : stag ? YELLOW : GREEN);
        }
      }
      const hits = eventsOf(ev, 'vehicleImpact');
      for (const h of hits) {
        cross(v, h.x, h.y, WHITE, 5, 2);
        const [a, b] = P(v, h.x, h.y);
        cv.arrow(a, b, a + h.nx * 30, b + h.ny * 30, CYAN, 2);
      }
      const first = hits[0];
      let outcome: string;
      if (lane.wall === 'fence')
        outcome = eventsOf(ev, 'openingChanged').length
          ? 'PLOT PRZEWROCONY, AUTO JEDZIE DALEJ'
          : 'STOP NA PLOCIE';
      else if (lane.wall === 'wall') outcome = `STOP NA SCIANIE`;
      else
        outcome = died
          ? fell
            ? 'PRZEWROCONY I PRZEJECHANY: SMIERC'
            : 'SMIERC OD RAZU'
          : fell
            ? 'PRZEWROCONY, PRZEJECHANY, ZYJE'
            : stag
              ? 'ZACHWIANY, ODEPCHNIETY'
              : 'ODEPCHNIETY';
      const hitTxt = first
        ? `UDERZENIE ${first.speed.toFixed(1)} M/S, ${(first.energy / 1000).toFixed(1)} KJ`
        : '';
      cv.text(
        24,
        v.oy + 8,
        `${lane.speed} M/S (${Math.round(lane.speed * 3.6)} KM/H) -> ${lane.label}: ${outcome}`,
        WHITE,
        2,
      );
      cv.text(24, v.oy + laneH - 20, hitTxt, GREY, 2);
      if (lane.label === 'ZOMBIE') {
        const expected = lane.speed >= 9 ? 'dead' : lane.speed >= 4 ? 'down' : 'stagger';
        const got = died && !fell ? 'dead' : fell ? 'down' : stag ? 'stagger' : 'push';
        expect(`${lane.speed}:${got}`).toBe(`${lane.speed}:${expected}`);
      }
    });
    await save('fiz-car-ram.png', cv);
  });
});
