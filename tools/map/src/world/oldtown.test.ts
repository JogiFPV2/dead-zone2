import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inORect, oRectsOverlap, type Pt } from './geom.js';
import { planOldTown } from './oldtown.js';
import { FALLBACK_WORLD_SIZE, planWorld, WORLD_PLAN_VERSION, type WorldPlan } from './plan.js';

const plans = [planWorld({ seed: 1993 }), planWorld({ seed: 7, size: FALLBACK_WORLD_SIZE })];

/** Old town ring of a settlement, re-derived from the same pure inputs as the plan. */
function ringOf(p: WorldPlan, id: number) {
  const s = p.settlements[id]!;
  return planOldTown({
    seed: p.seed,
    id: s.id,
    x: s.x,
    y: s.y,
    r: s.r,
    angle: s.angle,
    city: s.kind === 'city',
  });
}
const inRing = (t: ReturnType<typeof planOldTown>, q: Pt) =>
  Math.hypot(q.x - t.centre.x, q.y - t.centre.y) <
  t.ringAt(Math.atan2(q.y - t.centre.y, q.x - t.centre.x));

describe('old town (irregular core of every city and town)', { timeout: 60_000 }, () => {
  it('has a square with the town hall, a church and packed tenements inside the ring', () => {
    for (const p of plans)
      for (const s of p.settlements.filter((k) => k.kind !== 'village')) {
        const t = ringOf(p, s.id);
        const inside = p.buildings.filter((b) => inRing(t, b));
        expect(p.areas.some((a) => a.kind === 'plaza' && inORect(t.square, a.x, a.y))).toBe(true);
        expect(inside.some((b) => b.kind === 'office' && inORect(t.square, b.x, b.y))).toBe(true);
        expect(
          p.buildings.some(
            (b) => b.kind === 'church' && Math.hypot(b.x - t.square.x, b.y - t.square.y) < 120,
          ),
          `church at ${s.kind} ${s.id}`,
        ).toBe(true);
        const tenements = inside.filter((b) => b.kind === 'tenement').length;
        expect(tenements, `${s.kind} ${s.id}`).toBeGreaterThan(s.kind === 'city' ? 250 : 40);
        // Narrow, deep lots (frontage 5–13 m), never a grid block inside the ring.
        for (const b of inside.filter((k) => k.kind === 'tenement'))
          expect(b.w).toBeLessThanOrEqual(13);
        expect(p.areas.some((a) => a.kind === 'block' && !a.round && inRing(t, a))).toBe(false);
      }
  });

  it('is irregular: crooked streets, ring not a circle, square off the grid', () => {
    const p = plans[0]!;
    for (const s of p.settlements.filter((k) => k.kind !== 'village')) {
      const t = ringOf(p, s.id);
      const radii = Array.from({ length: 36 }, (_, k) => t.ringAt((k / 36) * Math.PI * 2));
      expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.1);
      expect(t.radials.length).toBeGreaterThanOrEqual(4);
      expect(t.radials.some((r) => r.length > 2)).toBe(true);
      const da = Math.abs(
        Math.atan2(Math.sin(t.square.a - s.angle), Math.cos(t.square.a - s.angle)),
      );
      expect(da).toBeLessThan(0.3);
    }
    // Lot directions follow their streets: many distinct angles, unlike the grid.
    const t = ringOf(p, p.settlements.find((k) => k.kind === 'city')!.id);
    const angles = new Set(
      p.buildings
        .filter((b) => b.kind === 'tenement' && inRing(t, b))
        .map((b) => Math.round((((b.a % Math.PI) + Math.PI) % Math.PI) * 10)),
    );
    expect(angles.size).toBeGreaterThan(15);
  });

  it('packs houses wall to wall without overlaps', () => {
    for (const p of plans)
      for (const s of p.settlements.filter((k) => k.kind !== 'village')) {
        const t = ringOf(p, s.id);
        const inside = p.buildings.filter((b) => inRing(t, b));
        let bad = 0;
        for (let i = 0; i < inside.length; i++)
          for (let j = i + 1; j < inside.length; j++)
            if (oRectsOverlap(inside[i]!, inside[j]!, 0.01)) bad++;
        expect(bad).toBe(0);
      }
  });

  it('pins the plan output to WORLD_PLAN_VERSION (bump it when this digest changes)', () => {
    const p = plans[1]!;
    const round = (v: number) => Math.round(v * 10) / 10;
    const d = createHash('sha1')
      .update(
        JSON.stringify([
          p.buildings.map((b) => [round(b.x), round(b.y), round(b.w), round(b.h), b.kind]),
          p.roads.map((r) => [r.cls, r.pts.length]),
          p.areas.length,
        ]),
      )
      .digest('hex');
    expect({ version: WORLD_PLAN_VERSION, digest: d }).toEqual({
      version: 'plan-4',
      digest: 'be0d9b32dbfb1053250e4b912f28ceb7eea1cc09',
    });
  });
});
