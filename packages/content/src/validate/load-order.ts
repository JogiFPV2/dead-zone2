import type { ModManifest } from '../schemas/mod-manifest.js';
import type { ErrorSink } from './errors.js';

export interface OrderablePack {
  dir: string;
  manifest: ModManifest;
}

/**
 * Kolejność wczytywania: zależności (wymagane i opcjonalne, jeśli są) oraz `loadAfter`
 * przed modem, `loadBefore` po nim. Remisy: mniejsze `priority`, potem id — deterministycznie.
 * Brak wymaganej zależności, duplikat id moda i cykl to błędy `dependency`.
 */
export function resolveLoadOrder<T extends OrderablePack>(
  packs: readonly T[],
  sink: ErrorSink,
): T[] {
  const byId = new Map<string, T>();
  for (const p of packs) {
    const dup = byId.get(p.manifest.id);
    if (dup) {
      sink.add(err(p, '$.id', `mod „${p.manifest.id}” podany dwa razy (też ${dup.dir})`));
      continue;
    }
    byId.set(p.manifest.id, p);
  }

  const after = new Map<string, Set<string>>([...byId.keys()].map((id) => [id, new Set()]));
  for (const p of byId.values()) {
    const deps = after.get(p.manifest.id)!;
    p.manifest.dependencies.forEach((d, i) => {
      if (byId.has(d.id)) deps.add(d.id);
      else if (!d.optional) {
        sink.add(err(p, `$.dependencies[${i}].id`, `brak wymaganej zależności „${d.id}”`));
      }
    });
    p.manifest.loadAfter.forEach((id) => byId.has(id) && deps.add(id));
    p.manifest.loadBefore.forEach((id) => byId.has(id) && after.get(id)!.add(p.manifest.id));
  }

  const cmp = (a: T, b: T) =>
    a.manifest.priority - b.manifest.priority || a.manifest.id.localeCompare(b.manifest.id);
  const ordered: T[] = [];
  const done = new Set<string>();
  let remaining = [...byId.values()];
  while (remaining.length > 0) {
    const ready = remaining.filter((p) => [...after.get(p.manifest.id)!].every((d) => done.has(d)));
    if (ready.length === 0) {
      const ids = remaining.map((p) => p.manifest.id).join(', ');
      for (const p of remaining)
        sink.add(err(p, '$', `cykl w kolejności wczytywania modów: ${ids}`));
      break;
    }
    const next = ready.sort(cmp)[0]!;
    ordered.push(next);
    done.add(next.manifest.id);
    remaining = remaining.filter((p) => p !== next);
  }
  return ordered;
}

function err(p: OrderablePack, path: string, message: string) {
  return { code: 'dependency' as const, message, pack: p.dir, file: 'mod.json', path };
}
