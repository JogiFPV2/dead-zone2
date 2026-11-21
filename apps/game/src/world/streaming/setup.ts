import type { Object3D } from 'three';
import { MapObjects } from '../map-objects.js';
import { Structures } from '../structures.js';
import { Terrain } from '../terrain.js';
import { STREAM_PRESETS, VIEW_DISTANCES, type StreamConfig, type ViewDistance } from './rings.js';
import type { ChunkBounds, WorldChunkSource } from './source.js';
import { ChunkStreamer } from './streamer.js';
import { StreamedWorldRenderer } from './world-renderer.js';

export interface WorldStreaming {
  streamer: ChunkStreamer;
  terrain: Terrain;
  structures: Structures;
  mapObjects: MapObjects;
  lod: StreamedWorldRenderer;
  /** Scene roots to add (terrain, structures, map objects, mid / far LOD + decor). */
  roots: Object3D[];
}

/** `?view=low|medium|high` beats the setting. */
export function streamConfigFor(setting: ViewDistance | undefined, query?: string): StreamConfig {
  const q = new URLSearchParams(query ?? '').get('view');
  const v = (VIEW_DISTANCES as readonly string[]).includes(q ?? '') ? (q as ViewDistance) : setting;
  return STREAM_PRESETS[v ?? 'medium'];
}

/**
 * Small authored maps (content maps, test map) stay fully in the near ring, exactly as before
 * streaming: if the whole map fits the near cap, the near radius covers all of it.
 */
export function fitSmallWorld(cfg: StreamConfig, b: ChunkBounds): StreamConfig {
  const w = b.cx1 - b.cx0 + 1;
  const h = b.cy1 - b.cy0 + 1;
  if (w * h > cfg.maxChunks[0]) return cfg;
  const span = Math.max(w, h);
  const [n, m, f] = cfg.radii;
  return { ...cfg, radii: [Math.max(n, span), Math.max(m, span), Math.max(f, span)] };
}

/** Near ring over the whole world, without caps (authored maps drawn by the town kit). */
export function wholeWorldNear(cfg: StreamConfig, b: ChunkBounds): StreamConfig {
  const span = Math.max(b.cx1 - b.cx0 + 1, b.cy1 - b.cy0 + 1);
  const n = (2 * span + 1) ** 2;
  return { ...cfg, radii: [span, span, span], maxChunks: [n, n, n] };
}

/**
 * The world's render layers on top of a streaming source: terrain, structures and map objects
 * load / unload per chunk in the near ring (same meshes as before streaming), mid / far rings
 * get merged LOD meshes. Call `streamer.update([player, cameraTarget])` once per frame.
 */
export function createWorldStreaming(
  source: WorldChunkSource,
  cfg: StreamConfig,
  opts: {
    /** `greyBox: false`: terrain / structures come from elsewhere (town kit); only map objects. */
    greyBox?: boolean;
    /**
     * Big streamed world drawn by streamed near layers of its own (generated maps + town kit):
     * rings as configured, no whole-map near ring.
     */
    streamed?: boolean;
    /** `false`: decor instances are drawn by another layer (town kit trees). */
    decor?: boolean;
  } = {},
): WorldStreaming {
  const greyBox = opts.greyBox ?? true;
  const lod = new StreamedWorldRenderer(
    source.edgePalette,
    opts.decor ?? true,
    opts.streamed ? source.tilePalette : undefined,
  );
  // Town kit maps are laid out whole by the kit: keep every map object loaded too (as before
  // streaming) and no grey mid / far LOD over the kit's meshes.
  const fitted = opts.streamed
    ? cfg
    : greyBox
      ? fitSmallWorld(cfg, source.bounds)
      : wholeWorldNear(cfg, source.bounds);
  const streamer = new ChunkStreamer(source, lod, fitted);
  const terrain = new Terrain(streamer.loaded);
  const structures = new Structures(streamer.loaded, false);
  const mapObjects = new MapObjects();
  if (greyBox) {
    lod.addNearLayer({
      loadChunk: (cx, cy, z) => {
        terrain.loadChunk(cx, cy, z);
        return terrain.statsOf(cx, cy, z);
      },
      unloadChunk: (cx, cy, z) => terrain.unloadChunk(cx, cy, z),
    });
    lod.addNearLayer({
      loadChunk: (cx, cy, z) => {
        structures.loadChunk(cx, cy, z);
        return structures.statsOf(cx, cy, z);
      },
      unloadChunk: (cx, cy, z) => structures.unloadChunk(cx, cy, z),
    });
  }
  lod.addNearLayer({
    loadChunk: (cx, cy, z) => {
      const data = streamer.loaded.getChunk(cx, cy, z);
      if (data) mapObjects.loadChunk(data);
    },
    unloadChunk: (cx, cy, z) => mapObjects.unloadChunk(cx, cy, z),
  });
  return {
    streamer,
    terrain,
    structures,
    mapObjects,
    lod,
    roots: greyBox
      ? [terrain.root, structures.root, mapObjects.root, lod.root]
      : [mapObjects.root, lod.root],
  };
}
