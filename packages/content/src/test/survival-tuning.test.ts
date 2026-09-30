import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '../bundle/content-bundle.js';
import { baseBundle, DAY_MIN, minutesTo } from './base-bundle.js';

const enterAt = (b: ContentBundle, moodle: string, level: number) =>
  b.moodles[`base:${moodle}`]?.levels[level - 1]?.enterAt ?? NaN;

describe('strojenie przetrwania (doba gry = 60 min rzeczywistych)', () => {
  it('bezczynna postać jest głodna po ~1 dobie, a spragniona po ~pół doby', async () => {
    const b = await baseBundle();
    const { needs } = b.worldSettings.survival;
    expect(b.worldSettings.dayLengthMinutes).toBe(60);
    const hungry = minutesTo(enterAt(b, 'hunger', 1), needs.hungerPerMin) / DAY_MIN;
    const thirsty = minutesTo(enterAt(b, 'thirst', 1), needs.thirstPerMin) / DAY_MIN;
    expect(hungry).toBeGreaterThan(0.9);
    expect(hungry).toBeLessThan(1.1);
    expect(thirsty).toBeGreaterThan(0.45);
    expect(thirsty).toBeLessThan(0.55);
  });

  it('bez picia umiera w 2–4 doby, bez jedzenia później, ale przed 8 dobą', async () => {
    const b = await baseBundle();
    const { needs, health } = b.worldSettings.survival;
    const die = (perMin: number, d: { fromStat: number; healthLossPerMin: number }) =>
      (minutesTo(d.fromStat, perMin) + 100 / d.healthLossPerMin) / DAY_MIN;
    const noWater = die(needs.thirstPerMin, health.dehydration);
    const noFood = die(needs.hungerPerMin, health.starvation);
    expect(noWater).toBeGreaterThan(2);
    expect(noWater).toBeLessThan(4);
    expect(noFood).toBeGreaterThan(noWater);
    expect(noFood).toBeLessThan(8);
  });

  it('obrażenia z głodu i pragnienia zaczynają się na ostatnim poziomie moodla', async () => {
    const b = await baseBundle();
    const { health } = b.worldSettings.survival;
    expect(health.starvation.fromStat).toBe(enterAt(b, 'hunger', 4));
    expect(health.dehydration.fromStat).toBe(enterAt(b, 'thirst', 4));
  });

  it('zmęczenie po ~16 h na jawie, a noc w łóżku to 6–9 h snu', async () => {
    const b = await baseBundle();
    const { needs, sleep } = b.worldSettings.survival;
    const tired = enterAt(b, 'fatigue', 1);
    expect(minutesTo(tired, needs.fatiguePerMin) / 60).toBeCloseTo(16, 0);
    const bedHours = (tired - sleep.wakeAtFatigue) / sleep.surfaces.bed.fatigueRecoveryPerMin / 60;
    expect(bedHours).toBeGreaterThan(6);
    expect(bedHours).toBeLessThan(9);
    expect(sleep.surfaces.floor.fatigueRecoveryPerMin).toBeLessThan(
      sleep.surfaces.bed.fatigueRecoveryPerMin,
    );
  });

  it('wysiłek mnoży potrzeby rosnąco: bezruch < chód < bieg < sprint', async () => {
    const { activity } = (await baseBundle()).worldSettings.survival;
    const order = [activity.idle, activity.walking, activity.running, activity.sprinting];
    for (const need of ['hunger', 'thirst', 'fatigue'] as const) {
      const v = order.map((a) => a[need]);
      expect([...v].sort((x, y) => x - y)).toEqual(v);
    }
    expect(activity.sprinting.endurancePerMin).toBeLessThan(0);
    expect(activity.sleeping.hunger).toBeLessThan(1);
  });

  it('ugryzienie zakaża częściej niż rana szarpana i zadrapanie; śmierć po inkubacji', async () => {
    const { wounds, infection } = (await baseBundle()).worldSettings.survival;
    const t = wounds.types;
    expect(t.bite.zombieInfectionChance).toBeGreaterThan(t.laceration.zombieInfectionChance);
    expect(t.laceration.zombieInfectionChance).toBeGreaterThan(t.scratch.zombieInfectionChance);
    expect(infection.deathAfterMin.min).toBeGreaterThan(infection.incubationMin.max);
  });
});
