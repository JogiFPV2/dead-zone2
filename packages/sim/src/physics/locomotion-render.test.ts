/* eslint-disable no-restricted-globals -- the DZ_SHOTS env switch for the debug pictures, not sim state. */
import type { Gait } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS } from '../core/constants.js';
import { moveGait } from '../test/helpers.js';
import {
  locoSim,
  profileRun,
  trace,
  turnRun,
  type LocoSample,
} from '../test/locomotion-fixtures.js';
import { Canvas, nodeDeflate, writeFileIfNode, type Rgb } from '../test/topdown.js';
import { GAIT_PROFILES, LOCO_SPEED_MPS } from './constants.js';

/**
 * Headless debug renders of character locomotion (speed curves per gait, turns, walls). Always
 * rendered and checked; written as PNG only when `DZ_SHOTS` names a directory:
 * `DZ_SHOTS=/workspace/deadzone-shots pnpm --filter @deadzone/sim exec vitest run locomotion-render`.
 */
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const OUT = env?.DZ_SHOTS;
const R = PLAYER_RADIUS;

const WHITE: Rgb = [235, 235, 235];
const GREY: Rgb = [130, 134, 140];
const DIM: Rgb = [50, 53, 59];
const WALL: Rgb = [200, 170, 120];
const COL: Record<Gait, Rgb> = {
  sneak: [110, 160, 240],
  walk: [90, 200, 110],
  run: [240, 200, 70],
  sprint: [235, 80, 70],
};
const GAITS4: Gait[] = ['sneak', 'walk', 'run', 'sprint'];
const NAME: Record<Gait, string> = {
  sneak: 'SKRADANIE',
  walk: 'CHOD',
  run: 'BIEG',
  sprint: 'SPRINT',
};

async function save(name: string, cv: Canvas): Promise<void> {
  const png = cv.png(await nodeDeflate());
  expect([...png.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
  if (OUT) await writeFileIfNode(`${OUT}/${name}`, png);
}

/** World → pixel mapping of one panel. */
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
function gridLines(v: View, x1: number, y1: number): void {
  for (let x = Math.ceil(v.x0); x <= x1; x++) {
    const [a, b] = P(v, x, v.y0);
    const [, d] = P(v, x, y1);
    v.cv.line(a, b, a, d, DIM);
  }
  for (let y = Math.ceil(v.y0); y <= y1; y++) {
    const [a, b] = P(v, v.x0, y);
    const [c] = P(v, x1, y);
    v.cv.line(a, b, c, b, DIM);
  }
}
function pathLine(v: View, pts: readonly LocoSample[], c: Rgb, w = 3): void {
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = P(v, pts[i - 1]!.x, pts[i - 1]!.y);
    const [d, e] = P(v, pts[i]!.x, pts[i]!.y);
    v.cv.line(a, b, d, e, c, w);
  }
}
function body(v: View, p: { x: number; y: number }, c: Rgb, w = 1): void {
  const [x, y] = P(v, p.x, p.y);
  v.cv.ring(x, y, R * v.s, c, w);
}

describe('locomotion: debug renders', () => {
  it('fiz-move-profiles.png: speed and acceleration over time per gait', async () => {
    const runs = GAITS4.map((g) => profileRun(g));
    const W = 1200;
    const H = 830;
    const cv = new Canvas(W, H);
    cv.text(
      20,
      16,
      'RUCH POSTACI: PROFILE CHODU (PRZYSPIESZANIE, PUSZCZENIE, HAMOWANIE)',
      WHITE,
      3,
    );
    cv.text(
      20,
      44,
      'JERK-LIMITED, BEZ PRZESTRZELENIA. PUSZCZENIE KLAWISZA PO 1.5 S. 20 HZ',
      GREY,
      2,
    );
    const px0 = 90;
    const pw = W - 130;
    const tMax = 3.5;
    const plot = (top: number, h: number, lo: number, hi: number, step: number, unit: string) => {
      for (let k = lo; k <= hi + 1e-9; k += step) {
        const y = top + h - ((k - lo) / (hi - lo)) * h;
        cv.line(px0, y, px0 + pw, y, Math.abs(k) < 1e-9 ? GREY : DIM);
        cv.text(px0 - 50, y - 5, `${k}`, GREY, 2);
      }
      for (let t = 0; t <= tMax + 1e-9; t += 0.5) {
        const x = px0 + (t / tMax) * pw;
        cv.line(x, top, x, top + h, DIM);
        cv.text(x - 8, top + h + 8, `${t}`, GREY, 2);
      }
      cv.text(px0 - 80, top - 22, unit, GREY, 2);
      return (t: number, val: number): [number, number] => [
        px0 + (t / tMax) * pw,
        top + h - ((val - lo) / (hi - lo)) * h,
      ];
    };
    const sp = plot(100, 300, 0, 5, 1, 'PREDKOSC M/S');
    const ac = plot(470, 200, -10, 10, 5, 'PRZYSPIESZENIE M/S2');
    cv.text(px0 + pw - 10, 690, 'S', GREY, 2);
    for (const r of runs) {
      const c = COL[r.gait];
      let prev: [number, number] = sp(0, 0);
      let prevA: [number, number] = ac(0, 0);
      let last = 0;
      r.samples.forEach((smp, i) => {
        const t = (i + 1) / 20;
        const cur = sp(t, smp.speed);
        cv.line(prev[0], prev[1], cur[0], cur[1], c, 3);
        prev = cur;
        const a = (smp.speed - last) * 20;
        last = smp.speed;
        const ca = ac(t, a);
        cv.line(prevA[0], prevA[1], ca[0], ca[1], c, 2);
        prevA = ca;
      });
      const [mx, my] = sp(r.ticksToMax / 20, r.maxSpeed);
      cv.disc(mx, my, 5, c);
    }
    const [rx] = sp(1.5, 0);
    cv.line(rx, 100, rx, 670, WHITE);
    cv.text(rx + 6, 104, 'PUSZCZENIE', WHITE, 2);
    cv.text(
      20,
      715,
      'TRYB        V MAX      DO V MAX    DROGA HAMOWANIA     A / HAM / JERK',
      GREY,
      2,
    );
    runs.forEach((r, i) => {
      const p = GAIT_PROFILES[r.gait];
      const y = 740 + i * 22;
      cv.rect(20, y, 14, 10, COL[r.gait]);
      const cells = [
        NAME[r.gait].padEnd(10),
        `${r.maxSpeed.toFixed(2)} M/S`.padEnd(11),
        `${(r.ticksToMax / 20).toFixed(2)} S`.padEnd(12),
        `${r.brakeDist.toFixed(2)} M W ${(r.brakeTicks / 20).toFixed(2)} S`.padEnd(20),
        `${p.accel} / ${p.brake} / ${p.jerk}`,
      ];
      cv.text(42, y, cells.join(''), COL[r.gait], 2);
    });
    expect(runs.map((r) => r.maxSpeed.toFixed(3))).toEqual(
      GAITS4.map((g) => LOCO_SPEED_MPS[g].toFixed(3)),
    );
    await save('fiz-move-profiles.png', cv);
  });

  it('fiz-move-turns.png: 90° and 180° turns at walk, run and sprint', async () => {
    const gaits: Gait[] = ['walk', 'run', 'sprint'];
    const W = 1200;
    const H = 760;
    const cv = new Canvas(W, H);
    cv.text(
      20,
      16,
      'RUCH POSTACI: SKRET 90 I ZAWROT 180 (KIERUNEK RUCHU, PATRZENIE OSOBNO)',
      WHITE,
      3,
    );
    cv.text(
      20,
      44,
      'KROPKI CO 0.1 S. SKRET WOLNIEJ PRZY WIEKSZEJ PREDKOSCI, ZAWROT PRZEZ HAMOWANIE. SIATKA 1 M',
      GREY,
      2,
    );
    // Panel 1: 90° (input turns from +x to −y at the cross).
    const v1: View = { cv, x0: -6, y0: -7, s: 52, ox: 30, oy: 90 };
    gridLines(v1, 4, 2.5);
    cv.text(40, 96, 'SKRET 90', WHITE, 3);
    const t90 = gaits.map((g) => turnRun(g, 90));
    for (const t of t90) {
      const p0 = t.samples[t.turnAt - 1]!;
      const pts = t.samples
        .slice(t.turnAt - 12)
        .map((p) => ({ ...p, x: p.x - p0.x, y: p.y - p0.y }))
        .filter((p) => p.y >= -6.8);
      pathLine(v1, pts, COL[t.gait], 3);
      pts.forEach((p, i) => {
        if (i % 2 === 0) {
          const [x, y] = P(v1, p.x, p.y);
          cv.disc(x, y, 3, COL[t.gait]);
        }
      });
    }
    const [cx, cy] = P(v1, 0, 0);
    cv.line(cx - 8, cy - 8, cx + 8, cy + 8, WHITE, 2);
    cv.line(cx - 8, cy + 8, cx + 8, cy - 8, WHITE, 2);
    cv.text(cx + 10, cy + 10, 'ZMIANA KIERUNKU', WHITE, 2);
    // Panel 2: 180° as the velocity along the old direction over time (through zero = braking).
    const t180 = gaits.map((g) => turnRun(g, 180));
    const gx0 = 660;
    const gw = 500;
    const gy0 = 130;
    const gh = 420;
    const tSpan = 1.5;
    const X = (t: number) => gx0 + (t / tSpan) * gw;
    const Y = (v: number) => gy0 + gh / 2 - (v / 5) * (gh / 2);
    cv.text(610, 96, 'ZAWROT 180: PREDKOSC WZDLUZ STAREGO KIERUNKU', WHITE, 2);
    cv.rect(gx0, Y(0.35), gw, Y(-0.35) - Y(0.35), [45, 45, 70]);
    for (let k = -5; k <= 5; k++) {
      cv.line(gx0, Y(k), gx0 + gw, Y(k), k === 0 ? GREY : DIM);
      if (k % 1 === 0) cv.text(gx0 - 34, Y(k) - 5, `${k}`, GREY, 2);
    }
    for (let t = 0; t <= tSpan + 1e-9; t += 0.25) {
      cv.line(X(t), gy0, X(t), gy0 + gh, DIM);
      if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-9)
        cv.text(X(t) - 8, gy0 + gh + 8, `${t}`, GREY, 2);
    }
    cv.text(gx0 - 50, gy0 - 20, 'M/S', GREY, 2);
    cv.text(gx0 + gw - 60, gy0 + gh + 26, 'S OD ZAWROTU', GREY, 2);
    t180.forEach((t, row) => {
      const pts = t.samples.slice(t.turnAt - 1, t.turnAt + 30);
      for (let i = 1; i < pts.length; i++) {
        cv.line(X((i - 1) / 20), Y(pts[i - 1]!.vx), X(i / 20), Y(pts[i]!.vx), COL[t.gait], 3);
      }
      cv.text(
        610,
        600 + row * 22,
        `${NAME[t.gait]}: HAMOWANIE ${t.overshoot.toFixed(2)} M, PELNY ZAWROT ${(t.ticksToAlign / 20).toFixed(2)} S`,
        COL[t.gait],
        2,
      );
    });
    cv.text(gx0 + 6, Y(0.35) - 14, 'PONIZEJ 0.35 M/S: OBROT W MIEJSCU', [150, 150, 220], 2);
    // Legend.
    t90.forEach((t, i) => {
      const y = 650 + i * 24;
      cv.rect(40, y, 14, 10, COL[t.gait]);
      cv.text(
        62,
        y,
        `${NAME[t.gait]} ${LOCO_SPEED_MPS[t.gait]} M/S: 90 W ${(t.ticksToAlign / 20).toFixed(2)} S, WYNIESIENIE ${t.overshoot.toFixed(2)} M`,
        COL[t.gait],
        2,
      );
    });
    expect(t90[0]!.ticksToAlign).toBeLessThan(t90[1]!.ticksToAlign);
    await save('fiz-move-turns.png', cv);
  });

  it('fiz-move-walls.png: sliding along a wall, an inner corner, rounding a wall end', async () => {
    const W = 1200;
    const H = 700;
    const cv = new Canvas(W, H);
    cv.text(
      20,
      16,
      'RUCH POSTACI: SLIZG PO SCIANIE, ROG WEWNETRZNY, OBCHODZENIE KONCA SCIANY',
      WHITE,
      3,
    );
    cv.text(
      20,
      44,
      'OKREGI = POSTAC (R 0.3 M) CO 0.25 S, LINIA = SRODEK. SUBKROKI, BEZ DRGAN I ZAKLESZCZEN',
      GREY,
      2,
    );
    const wall = (v: View, x0: number, y0: number, x1: number, y1: number) => {
      const [a, b] = P(v, x0, y0);
      const [c, d] = P(v, x1, y1);
      cv.line(a, b, c, d, WALL, 4);
    };
    // Panel A: 30° into the wall x = 12 while running.
    const va: View = { cv, x0: 9.5, y0: 3.5, s: 44, ox: 30, oy: 90 };
    gridLines(va, 15.5, 16.5);
    const sa = locoSim(10.5, 4.5, { wallW: (x) => x === 12 });
    moveGait(sa, 0.5, Math.sqrt(3) / 2, 'run');
    const pa = trace(sa, 60);
    wall(va, 12, 3.5, 12, 16.5);
    pathLine(va, pa, COL.run, 3);
    pa.forEach((p, i) => i % 5 === 4 && body(va, p, COL.run));
    const touch = pa.filter((p) => p.vx === 0 && p.speed > 0);
    const vt = touch.at(-1)!.speed;
    cv.text(30, 96, 'SLIZG: BIEG 30 DO SCIANY', WHITE, 2);
    cv.text(30, 116, `STYCZNA ${vt.toFixed(3)} M/S = 3.75 X COS 30`, COL.run, 2);
    // Panel B: inner corner (walls x = 12 and y = 8), sprint into it.
    const vb: View = { cv, x0: 8.5, y0: 6.5, s: 70, ox: 420, oy: 130 };
    gridLines(vb, 13, 13);
    const sb = locoSim(9.5, 11.5, { wallW: (x) => x === 12, wallN: (_x, y) => y === 8 });
    moveGait(sb, 1, -1, 'sprint');
    const pb = trace(sb, 260);
    wall(vb, 12, 6.5, 12, 13);
    wall(vb, 8.5, 8, 13, 8);
    pathLine(vb, pb, COL.sprint, 3);
    pb.forEach((p, i) => i % 5 === 4 && i < 60 && body(vb, p, COL.sprint));
    const rest = pb.slice(60);
    const distinct = new Set(rest.map((p) => `${p.x},${p.y}`)).size;
    body(vb, pb.at(-1)!, WHITE, 2);
    cv.text(420, 96, 'ROG: SPRINT W ROG', WHITE, 2);
    cv.text(420, 116, `${rest.length} TICKOW: ${distinct} POZYCJA, WARIANCJA 0`, COL.sprint, 2);
    // Panel C: rounding the end of a short wall (x = 12, y 5..7) when walking +x just above it.
    const vc: View = { cv, x0: 9, y0: 3, s: 70, ox: 820, oy: 130 };
    gridLines(vc, 14, 9.5);
    const sc = locoSim(9.5, 4.85, {
      wallW: (x, y) => x === 12 && (y === 5 || y === 6),
    });
    moveGait(sc, 1, 0, 'walk');
    const pc = trace(sc, 80).filter((p) => p.x <= 13.9);
    wall(vc, 12, 5, 12, 7);
    pathLine(vc, pc, COL.walk, 3);
    pc.forEach((p, i) => i % 5 === 4 && body(vc, p, COL.walk));
    const [ex, ey] = P(vc, 12, 5);
    cv.disc(ex, ey, 5, WALL);
    cv.text(820, 96, 'KONIEC SCIANY: CHOD', WHITE, 2);
    cv.text(820, 116, 'OBCHODZI ROG PO LUKU', COL.walk, 2);
    expect(distinct).toBe(1);
    expect(pc.at(-1)!.x).toBeGreaterThan(13.5);
    await save('fiz-move-walls.png', cv);
  });
});
