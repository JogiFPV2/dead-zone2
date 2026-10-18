import { describe, expect, it } from 'vitest';
import { baseBundle } from '../test/base-bundle.js';
import { BUILDING_KIND_ROOMS } from '../schemas/building-kind.js';
import { buildingKindFromRooms } from './building-kind-from-rooms.js';

const R = (...t: string[]) => t.map((x) => `base:room-${x}`);

describe('buildingKindFromRooms', () => {
  it('rodzaje budynków z generatora', () => {
    expect(buildingKindFromRooms(R('living-room', 'kitchen', 'bedroom', 'bathroom'))).toBe('house');
    expect(buildingKindFromRooms(R('shop', 'warehouse', 'living-room', 'bedroom'))).toBe('shop');
    expect(buildingKindFromRooms(R('shop', 'office', 'warehouse'))).toBe('shop');
    expect(buildingKindFromRooms(R('pharmacy', 'bathroom'))).toBe('pharmacy');
    expect(buildingKindFromRooms(R('hospital', 'office', 'pharmacy', 'bathroom'))).toBe('hospital');
    expect(buildingKindFromRooms(R('school', 'office', 'bathroom'))).toBe('school');
    expect(buildingKindFromRooms(R('police', 'office'))).toBe('police');
    expect(buildingKindFromRooms(R('gas-station'))).toBe('fuel');
    expect(buildingKindFromRooms(R('gym', 'bathroom'))).toBe('gym');
    expect(buildingKindFromRooms(R('office', 'bathroom'))).toBe('office');
    expect(buildingKindFromRooms(R('warehouse', 'office'))).toBe('office');
    expect(buildingKindFromRooms(R('warehouse'))).toBe('industrial');
    expect(buildingKindFromRooms(R('garage'))).toBe('garage');
    expect(buildingKindFromRooms(R('ruin'))).toBe('ruin');
    expect(buildingKindFromRooms(R('video-store'))).toBe('shop');
  });

  it('priorytet: publiczne > sklepy i usługi > dom > garaż; dom z garażem to dom', () => {
    expect(buildingKindFromRooms(R('garage', 'living-room', 'kitchen'))).toBe('house');
    expect(buildingKindFromRooms(R('garage', 'shop'))).toBe('shop');
    expect(buildingKindFromRooms(R('shop', 'hospital'))).toBe('hospital');
    expect(buildingKindFromRooms(new Set(R('bedroom', 'office')))).toBe('house');
  });

  it('nic mówiącego (sama sala, łazienka, pusto) → undefined', () => {
    expect(buildingKindFromRooms(R('hall'))).toBeUndefined();
    expect(buildingKindFromRooms(R('bathroom', 'hall'))).toBeUndefined();
    expect(buildingKindFromRooms([])).toBeUndefined();
  });

  it('każdy typ pomieszczenia jest w co najwyżej jednym wierszu; znane typy z danych paczki', async () => {
    const all = BUILDING_KIND_ROOMS.flatMap(([, rooms]) => [...rooms]);
    expect(new Set(all).size).toBe(all.length);
    const known = Object.keys((await baseBundle()).worldSettings.loot.roomAccepts);
    for (const r of all) expect(known, r).toContain(r);
  });
});
