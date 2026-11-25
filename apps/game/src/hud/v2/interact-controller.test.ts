import type { NearbyContainerView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../../state/game-state.js';
import { InteractController, SPOT_NAME } from './interact-controller.js';
import { TAP_MS } from './interact-hold.js';
import type { DoorTarget, EdgeAction } from '../../world/door-target.js';
import type { CoverChoice } from '../window-cover-items.js';

const fridge: NearbyContainerView = {
  id: 5,
  kind: 'world',
  type: 'base:fridge',
  x: 3,
  y: 2,
  z: 0,
  searched: false,
};

function setup(
  nearby: NearbyContainerView[],
  door?: DoorTarget,
  covers: CoverChoice[] = [],
  edge: EdgeAction[] = [],
) {
  const calls: string[] = [];
  let state: GameState = { ...INITIAL_GAME_STATE, nearby };
  let held = true;
  const c = new InteractController({
    state: () => state,
    player: () => ({ x: 2.5, y: 2.5 }),
    door: () => door,
    opening: (d: DoorTarget, cmd: string, item?: number) =>
      calls.push(
        cmd === 'toggleDoor'
          ? `door ${d.tx},${d.ty},${d.side}`
          : `${cmd} ${d.tx},${d.ty}${item === undefined ? '' : ` #${item}`}`,
      ),
    coverItems: () => covers,
    edgeActions: () => edge,
    useEdgeAction: (d: DoorTarget, id: string) => calls.push(`use ${id} ${d.tx},${d.ty}`),
    toast: (text) => calls.push(`toast ${text}`),
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

  const door = (
    dist: number,
    state: DoorTarget['state'] = 'closed',
    more: Partial<DoorTarget> = {},
  ): DoorTarget => ({
    tx: 2,
    ty: 3,
    z: 0,
    side: 'n',
    kind: 'door',
    dist,
    state,
    barricade: 0,
    glass: false,
    ...more,
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

  it('holding F at an open door (nothing in its menu) still searches the spot', () => {
    const t = setup([], door(0.6, 'open'));
    t.c.press(0);
    t.c.frame(TAP_MS, 0);
    expect(t.calls).toEqual(['search {"x":2,"y":2}']);
  });

  it('holding F at a closed door opens its menu; F / number keys pick an entry', () => {
    const t = setup([], door(0.6));
    t.c.press(0);
    expect(t.c.frame(TAP_MS, 0)).toMatchObject({
      mode: 'menu',
      title: 'Otwórz',
      items: ['Zabarykaduj'],
      sel: 0,
    });
    expect(t.calls).toEqual([]);
    expect(t.c.menuOpen).toBe(true);
    t.c.press(TAP_MS + 500);
    expect(t.calls).toEqual(['barricade 2,3']);
    expect(t.c.menuOpen).toBe(false);
    // A number key picks too; out of range does nothing.
    const u = setup([], door(0.6, 'locked'));
    u.c.press(0);
    u.c.frame(TAP_MS, 0);
    expect(u.c.choose(5)).toBe(false);
    expect(u.c.choose(0)).toBe(true);
    expect(u.calls).toEqual(['forceDoor 2,3']);
  });

  it('a tap at a closed window opens it, hold shows its menu; at a broken one climbs through', () => {
    // Paweł 24.11: windows open and close one by one like doors.
    const o = setup([], door(0.6, 'closed', { kind: 'window', glass: true }));
    o.c.press(0);
    o.release();
    o.c.frame(100, 0);
    expect(o.calls).toEqual(['door 2,3,n']);
    const t = setup([], door(0.6, 'closed', { kind: 'window', glass: true }));
    t.c.press(0);
    expect(t.c.frame(TAP_MS, 0)).toMatchObject({
      mode: 'menu',
      items: ['Otwórz', 'Rozbij', 'Zabarykaduj', 'Zasłoń…'],
    });
    expect(t.calls).toEqual([]);
    const u = setup([], door(0.6, 'broken', { kind: 'window' }));
    u.c.press(0);
    u.release();
    u.c.frame(100, 0);
    expect(u.calls).toEqual(['climbThrough 2,3']);
  });

  it('a timed opening action shows the ring at the edge with its title', () => {
    const t = setup([], door(0.6));
    t.setState({
      action: {
        kind: 'barricade',
        startTick: 0,
        endTick: 80,
        queued: 0,
        edge: { tx: 2, ty: 3, z: 0, side: 'n' },
      },
    });
    expect(t.c.frame(0, 40)).toMatchObject({ mode: 'search', title: 'Barykadowanie', x: 25 });
  });

  it('prompts at the door with its verb (open / close / locked)', () => {
    expect(setup([], door(0.6)).c.frame(0, 0)).toMatchObject({
      mode: 'prompt',
      search: true,
      hold: 'Więcej',
      label: 'Otwórz',
      x: 25,
      y: 30,
    });
    expect(setup([], door(0.6, 'open')).c.frame(0, 0)).toMatchObject({ label: 'Zamknij' });
    expect(setup([], door(0.6, 'locked')).c.frame(0, 0)).toMatchObject({
      label: 'Zamknięte',
      search: true,
      hold: 'Więcej',
    });
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

  it('„Zasłoń…” opens the item picker; picking sends coverWindow with the item', () => {
    const covers = [
      { id: 41, label: 'Koc' },
      { id: 42, label: 'Kurtka' },
    ];
    const t = setup([], door(0.6, 'closed', { kind: 'window', glass: true }), covers);
    t.c.press(0);
    t.c.frame(TAP_MS, 0);
    expect(t.c.choose(3)).toBe(true);
    expect(t.calls).toEqual([]);
    expect(t.c.frame(120, 0)).toMatchObject({
      mode: 'menu',
      title: 'Zasłoń…',
      items: ['Koc', 'Kurtka'],
    });
    expect(t.c.choose(1)).toBe(true);
    expect(t.calls).toEqual(['coverWindow 2,3 #42']);
    expect(t.c.menuOpen).toBe(false);
  });

  it('„Zasłoń…” with nothing to hang: a toast, no command', () => {
    const t = setup([], door(0.6, 'closed', { kind: 'window', glass: true }));
    t.c.press(0);
    t.c.frame(TAP_MS, 0);
    t.c.choose(3);
    expect(t.calls).toEqual(['toast Nie masz czym zasłonić']);
    expect(t.c.menuOpen).toBe(false);
  });

  it('a covered window offers „Zdejmij” (uncoverWindow)', () => {
    const cover = { item: 'base:blanket', lightPass: 0.1, blocksSight: true };
    const t = setup([], door(0.6, 'closed', { kind: 'window', glass: true, cover }));
    t.c.press(0);
    expect(t.c.frame(TAP_MS, 0)).toMatchObject({
      items: ['Otwórz', 'Rozbij', 'Zabarykaduj', 'Zdejmij'],
    });
    t.c.choose(3);
    expect(t.calls).toEqual(['uncoverWindow 2,3']);
  });

  it('door locks (Paweł 25.11): inside the lock turns without a key, outside the key entry', () => {
    const inside: EdgeAction[] = [
      { id: 'open', labelPl: 'Otwórz', enabled: true },
      { id: 'lock', labelPl: 'Zamknij na zamek', enabled: true },
      { id: 'knock', labelPl: 'Zapukaj', enabled: true },
    ];
    const t = setup([], door(0.6), [], inside);
    t.c.press(0);
    expect(t.c.frame(TAP_MS, 0)).toMatchObject({
      mode: 'menu',
      items: ['Zamknij na zamek', 'Zabarykaduj'],
    });
    t.c.choose(0);
    expect(t.calls).toEqual(['use lock 2,3']);

    // Outside without the key: the entry is greyed and says why when picked.
    const outside: EdgeAction[] = [
      {
        id: 'unlock-key',
        labelPl: 'Otwórz kluczem',
        enabled: false,
        reasonPl: 'Brak klucza do tego budynku',
      },
    ];
    const u = setup([], door(0.6, 'locked'), [], outside);
    u.c.press(0);
    expect(u.c.frame(TAP_MS, 0)).toMatchObject({
      items: ['Otwórz kluczem', 'Wyważ', 'Zabarykaduj'],
      disabled: [0],
    });
    u.c.choose(0);
    expect(u.calls).toEqual(['toast Brak klucza do tego budynku']);
  });

  it('focus: the container F acts on (its furniture lights up), not when a door wins', () => {
    expect(setup([fridge]).c.focus()).toBe(fridge);
    expect(setup([{ ...fridge, kind: 'ground' }]).c.focus()).toBeUndefined();
    expect(setup([fridge], door(0.5)).c.focus()).toBeUndefined();
    expect(setup([fridge], door(1.2)).c.focus()).toBe(fridge);
    const t = setup([fridge]);
    t.setState({ action: { kind: 'search', startTick: 0, endTick: 70, container: 5, queued: 0 } });
    expect(t.c.focus()).toBe(fridge);
  });
});
