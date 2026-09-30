import type { ModeCondition } from './objective.js';
import type { ZoneRef } from './zone-ref.js';

type Path = (string | number)[];

/** Minimalny kształt trybu potrzebny do zebrania odwołań (także przed pełnym parsowaniem). */
interface ModeShape {
  objective: { win?: ModeCondition | undefined; lose: ModeCondition[] };
  world: { zombies: { hordes: { zone: ZoneRef }[] } };
  npcs: { zone: ZoneRef }[];
  player: { spawnZone?: ZoneRef | undefined };
}

function fromCondition(
  c: ModeCondition,
  path: Path,
  out: { zones: { ref: ZoneRef; path: Path }[]; npcs: { npc: string; path: Path }[] },
): void {
  if (c.type === 'all' || c.type === 'any')
    c.conditions.forEach((x, i) => fromCondition(x, [...path, 'conditions', i], out));
  if (c.type === 'extractNpc') {
    out.zones.push({ ref: c.targetZone, path: [...path, 'targetZone'] });
    out.npcs.push({ npc: c.npcId, path: [...path, 'npcId'] });
  }
  if (c.type === 'npcDead') out.npcs.push({ npc: c.npcId, path: [...path, 'npcId'] });
}

/** Wszystkie odwołania trybu do stref i NPC, ze ścieżkami JSON (do błędów). */
export function modeZoneRefs(m: ModeShape) {
  const out = {
    zones: [] as { ref: ZoneRef; path: Path }[],
    npcs: [] as { npc: string; path: Path }[],
  };
  if (m.objective.win) fromCondition(m.objective.win, ['objective', 'win'], out);
  m.objective.lose.forEach((c, i) => fromCondition(c, ['objective', 'lose', i], out));
  m.world.zombies.hordes.forEach((h, i) =>
    out.zones.push({ ref: h.zone, path: ['world', 'zombies', 'hordes', i, 'zone'] }),
  );
  m.npcs.forEach((n, i) => out.zones.push({ ref: n.zone, path: ['npcs', i, 'zone'] }));
  if (m.player.spawnZone)
    out.zones.push({ ref: m.player.spawnZone, path: ['player', 'spawnZone'] });
  return out;
}
