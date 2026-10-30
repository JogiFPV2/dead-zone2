import { describe, expect, it } from 'vitest';
import { levelCrossingStats } from './level-crossing-check.js';
import { MAPS } from './level-crossing-maps.js';

/**
 * Level crossings on osm-okulickiego (rules in level-crossing-check.ts). Ratchet: today's counts; lower
 * them when the generator / data is fixed. `inBuilding`: depot tracks inside an OSM building
 * outline (known, not fixed in #373).
 */
const KNOWN = { missing: 14, inBuilding: 0, orphan: 0 };

describe('przejazdy kolejowe: osm-okulickiego', () => {
  it('każde przecięcie toru z jezdnią ma przejazd albo most (ratchet)', async () => {
    const samples: string[] = [];
    const s = levelCrossingStats(await MAPS['osm-okulickiego']!(), samples);
    console.log('[przejazdy] osm-okulickiego', JSON.stringify(s), samples.slice(0, 8));
    for (const k of ['missing', 'inBuilding', 'orphan'] as const)
      expect(s[k], `osm-okulickiego.${k} (${samples.slice(0, 10).join('; ')})`).toBeLessThanOrEqual(
        KNOWN[k],
      );
  }, 600_000);
});
