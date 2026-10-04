import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_PACK_DIR } from '@deadzone/content/node';
import type { FurnishOptions } from './furnish.js';

/** Tag of outdoor floor tiles in the content (same as the validator's `OUTDOOR_FLOOR_TAG`). */
const OUTDOOR = 'base:outdoor';
/** Outdoor floors where props (bins, benches, firewood) may stand: not the road or the parking. */
const PROP_FLOORS = new Set(['base:grass', 'base:sidewalk', 'base:dirt']);

/** Floor tiles of the base pack tagged `base:outdoor`. */
export function baseOutdoorFloors(): Set<string> {
  const dir = join(BASE_PACK_DIR, 'tiles');
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const list = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
      id: string;
      tags?: string[];
    }[];
    for (const t of list) if (t.tags?.includes(OUTDOOR)) out.add(t.id);
  }
  return out;
}

/** Furnishing options for maps built from base-pack tiles. */
export function baseFurnishOptions(seed = 1): FurnishOptions {
  const outdoor = baseOutdoorFloors();
  return {
    seed,
    outdoorFloor: (id) => outdoor.has(id),
    propFloor: (id) => PROP_FLOORS.has(id),
  };
}
