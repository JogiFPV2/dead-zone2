import type { NearbyContainerView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../../state/game-state.js';
import { InteractController, SPOT_NAME } from './interact-controller.js';
import { TAP_MS } from './interact-hold.js';
import type { DoorTarget } from '../../world/door-target.js';

const fridge: NearbyContainerView = {
  id: 5,
  kind: 'world',
  type: 'base:fridge',
  x: 3,
  y: 2,
  z: 0,
  searched: false,
};

function setup(nearby: NearbyContainerView[], door?: DoorTarget) {
  const calls: string[] = [];
  let state: GameState = { ...INITIAL_GAME_STATE, nearby };
  let held = true;
  const c = new InteractController({
    state: () => state,
    player: () => ({ x: 2.5, y: 2.5 }),
    door: () => door,
    toggleDoor: (d) => calls.push(`door ${d.tx},${d.ty},${d.side}`),
    held: () => held,
    interrupted: () => false,
    windowOpen: () => false,
    legacy: () => calls.push('legacy'),
    open: (id) => calls.push(`open ${id}`),
    search: (t) => calls.push(`search ${JSON.stringify(t)}`),
    cancel: () => calls.push('cancel'),
    project: (x, y) => ({ x: x * 10, y: y * 10 }),
    key: () => 'F',
    tickMs: 50,
  });
  return {
    c,
    calls,
    release: () => (held = false),
    setState: (s: Partial<GameState>) => (state = { ...state, ...s }),
  };
}

describe('InteractController', () => {
  it('tap opens, hold sends the sim search, releasing cancels it', () => {
    const t = setup([fridge]);
    t.c.press(0);
    expect(t.c.frame(TAP_MS, 0)).toMatchObject({ mode: 'search', progress: 0 });
    expect(t.calls).toEqual(['search {"container":5}']);
    t.setState({ action: { kind: 'search', startTick: 0, endTick: 70, container: 5, queued: 0 } });
    expect(t.c.frame(1000, 35)).toMatchObject({ mode: 'search', progress: 0.5, seconds: 3.5 });
    t.release();
    t.c.frame(1100, 37);
    expect(t.calls).toEqual(['search {"container":5}', 'cancel']);

    const u = setup([fridge]);
    u.c.press(0);
    u.release();
    u.c.frame(100, 0);
    expect(u.calls).toEqual(['open 5']);
  });

  it('shows the prompt in reach and searches the spot when nothing is near', () => {
    const t = setup([fridge]);
    expect(t.c.frame(0, 0)).toMatchObject({ mode: 'prompt', search: true, x: 35, y: 25 });
    const s = setup([]);
    expect(s.c.frame(0, 0)).toEqual({ mode: 'hidden' });
    s.c.press(0);
    expect(s.c.frame(TAP_MS, 0)).toMatchObject({ mode: 'search', name: SPOT_NAME });
    expect(s.calls).toEqual(['search {"x":2,"y":2}']);
  });

  it('a searched container opens on hold too', () => {
    const t = setup([{ ...fridge, searched: true }]);
    t.c.press(0);
    t.c.frame(TAP_MS, 0);
    expect(t.calls).toEqual(['open 5']);
  });

  const door = (dist: number, state: DoorTarget['state'] = 'closed'): DoorTarget => ({
    tx: 2,
    ty: 3,
    z: 0,
    side: 'n',
    dist,
    state,
  });

  it('a tap toggles the door in reach when no container is near', () => {
    const t = setup([], door(0.6));
    t.c.press(0);
    t.release();
    t.c.frame(100, 0);
    expect(t.calls).toEqual(['door 2,3,n']);
  });

  it('a tap prefers a container unless the door is very close', () => {
    const t = setup([fridge], door(1.2));
    t.c.press(0);
    t.release();
    t.c.frame(100, 0);
    expect(t.calls).toEqual(['open 5']);

    const u = setup([fridge], door(0.5));
    u.c.press(0);
    u.release();
    u.c.frame(100, 0);
    expect(u.calls).toEqual(['door 2,3,n']);
  });

  it('holding F near a door still searches the spot', () => {
    const t = setup([], door(0.6));
    t.c.press(0);
    t.c.frame(TAP_MS, 0);
    expect(t.calls).toEqual(['search {"x":2,"y":2}']);
  });

  it('prompts at the door with its verb (open / close / locked)', () => {
    expect(setup([], door(0.6)).c.frame(0, 0)).toMatchObject({
      mode: 'prompt',
      search: false,
      label: 'Otwórz',
      x: 25,
      y: 30,
    });
    expect(setup([], door(0.6, 'open')).c.frame(0, 0)).toMatchObject({ label: 'Zamknij' });
    expect(setup([], door(0.6, 'locked')).c.frame(0, 0)).toMatchObject({ label: 'Zamknięte' });
    // The container prompt keeps its default verb.
    expect(setup([fridge], door(1.2)).c.frame(0, 0)).toMatchObject({ search: true, x: 35 });
  });

  it('a zombie threat never cancels a running search, it only flags the ring', () => {
    const t = setup([fridge]);
    t.c.press(0);
    t.c.frame(TAP_MS, 0);
    t.setState({ action: { kind: 'search', startTick: 0, endTick: 70, container: 5, queued: 0 } });
    expect(t.c.frame(500, 10)).toMatchObject({ mode: 'search', threat: false });
    t.setState({ threat: 60 });
    expect(t.c.frame(1000, 35)).toMatchObject({ mode: 'search', progress: 0.5, threat: true });
    t.c.frame(1500, 45);
    expect(t.calls).toEqual(['search {"container":5}']);
  });
});
