import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@deadzone/protocol';
import { createSim } from '@deadzone/sim';
import { createTestMap, TEST_MAP_RANGE } from '../world/test-map.js';
import { chunkSourceToSimMap } from '../world/sim-map.js';
import { isDiscovered } from './bigmap-model.js';
import { SimBigMapSource } from './sim-source.js';

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

describe('SimBigMapSource (protocol)', () => {
  it('fog from bounds + base64, then chunksDiscovered cells', () => {
    const s = new SimBigMapSource(() => 1);
    s.applyView({ bounds: { cx0: -2, cy0: -1, cx1: 5, cy1: 6 }, discovered: b64([0b10, 0, 1]) });
    const g = s.fog();
    expect([g.cx0, g.cy0, g.width, g.height]).toEqual([-2, -1, 8, 8]);
    expect(isDiscovered(g, -1, -1)).toBe(true); // bit 1
    expect(isDiscovered(g, -2, 1)).toBe(true); // bit 16 = (1 − −1) · 8 + 0
    const v = s.fogVersion;
    s.applyEvents([{ type: 'chunksDiscovered', tick: 1, playerId: 0, cells: [[3, 3]] }]);
    expect(isDiscovered(s.fog(), 3, 3)).toBe(true);
    expect(s.fogVersion).toBe(v + 1);
  });

  it('trail replaced by `trail`, extended by `trailAdd`', () => {
    const s = new SimBigMapSource(() => 1);
    s.applyView({ trail: [0, 0, 16, 0] });
    s.applyView({ trailAdd: [32, 0] });
    expect([...s.trail()]).toEqual([0, 0, 16, 0, 32, 0]);
    s.applyView({ trail: [5, 5] });
    expect([...s.trail()]).toEqual([5, 5]);
  });

  it('marker commands, markersChanged, client-only showOnMinimap, Polish rejections', () => {
    const sent: unknown[] = [];
    const toasts: string[] = [];
    let seq = 0;
    const s = new SimBigMapSource(
      (c) => (sent.push(c), ++seq),
      () => 0,
      (t) => toasts.push(t),
    );
    s.addMarker({
      x: 10,
      y: 20,
      icon: 'base:marker-food',
      color: 'green',
      text: 'x'.repeat(50),
      showOnMinimap: false,
    });
    expect(sent[0]).toEqual({
      type: 'addMarker',
      x: 10,
      y: 20,
      icon: 'base:marker-food',
      color: 'green',
      text: 'x'.repeat(40),
    });
    const m = { id: 7, x: 10, y: 20, icon: 'base:marker-food', color: 'green' as const, text: 'a' };
    s.applyEvents([
      { type: 'markersChanged', tick: 2, playerId: 0, change: 'added', changed: 7, markers: [m] },
    ]);
    expect(s.markers()).toEqual([{ ...m, showOnMinimap: false }]);
    s.removeMarker(99);
    const reject = (seqNo: number, reason: 'unknown-marker'): SimEvent => ({
      type: 'commandRejected',
      tick: 3,
      playerId: 0,
      seq: seqNo,
      reason,
    });
    s.applyEvents([reject(2, 'unknown-marker'), reject(42, 'unknown-marker')]);
    expect(toasts).toEqual(['Ten znacznik już nie istnieje']);
  });
});

describe('SimBigMapSource with the real sim', () => {
  it('discovery, trail and markers survive save + load', () => {
    const map = chunkSourceToSimMap(createTestMap(), TEST_MAP_RANGE);
    const sim = createSim({ seed: 3, map, spawn: { x: 6.5, y: 6.5, z: 0 } });
    const a = new SimBigMapSource(
      () => 0,
      () => 0,
    );
    const pump = (src: SimBigMapSource, s: typeof sim) => {
      s.step();
      src.applyEvents(s.drainEvents());
      src.applyView(s.drainView()?.worldMap);
    };
    pump(a, sim);
    expect(a.fog().width).toBeGreaterThan(0);
    sim.enqueue({
      type: 'addMarker',
      x: 8,
      y: 9,
      icon: 'base:marker-base',
      color: 'yellow',
      text: 'Baza',
      tick: sim.tick,
      playerId: 0,
      seq: 1,
    });
    for (let i = 0; i < 40; i++) pump(a, sim);
    expect(a.markers().map((m) => m.text)).toEqual(['Baza']);
    const discovered = a.fog().bits.reduce((n, b) => n + (b ? 1 : 0), 0);
    expect(discovered).toBeGreaterThan(0);
    const trail = [...a.trail()];
    expect(trail.length).toBeGreaterThanOrEqual(2);

    const loaded = createSim({ seed: 3, map, spawn: { x: 6.5, y: 6.5, z: 0 }, load: sim.save() });
    const b = new SimBigMapSource(
      () => 0,
      () => 0,
    );
    pump(b, loaded);
    expect(b.markers().map((m) => [m.x, m.y, m.icon, m.color, m.text])).toEqual([
      [8, 9, 'base:marker-base', 'yellow', 'Baza'],
    ]);
    expect([...b.fog().bits]).toEqual([...a.fog().bits]);
    expect([...b.trail()]).toEqual(trail);
  });
});
