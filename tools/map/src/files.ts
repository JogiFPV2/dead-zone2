import { format, resolveConfig } from 'prettier';
import type { BuiltMap } from './build.js';

export interface MapFile {
  /** Relative to the pack root, e.g. `maps/demo-house/chunks/0_0_0.json`. */
  path: string;
  text: string;
}

/** Serializes a built map as pack files, formatted with the repo's Prettier config. */
export async function mapFiles(map: BuiltMap, configFile?: string): Promise<MapFile[]> {
  const options = (configFile ? await resolveConfig(configFile) : null) ?? {};
  const out: MapFile[] = [];
  const add = async (path: string, value: unknown) =>
    out.push({
      path,
      text: await format(JSON.stringify(value, null, 2), { ...options, parser: 'json' }),
    });
  await add(`maps/${map.id}/manifest.json`, map.manifest);
  for (const c of map.chunks) await add(`maps/${map.id}/chunks/${c.file}`, c.json);
  return out;
}
