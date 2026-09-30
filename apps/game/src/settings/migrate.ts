/** `migrations[n]` upgrades data of version n to n + 1. */
export type Migrations = Readonly<
  Record<number, (data: Record<string, unknown>) => Record<string, unknown>>
>;

export type MigrateResult =
  { ok: true; data: Record<string, unknown>; from: number } | { ok: false; reason: string };

/**
 * Runs the migration chain up to `current`. Data without a version counts as version 0.
 * Newer-than-current data is refused (no downgrades); a missing step or a throwing migration
 * fails, so the caller falls back to defaults.
 */
export function migrate(raw: unknown, current: number, migrations: Migrations): MigrateResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'nie obiekt' };
  }
  let data = raw as Record<string, unknown>;
  const v = data.version ?? 0;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
    return { ok: false, reason: 'zła wersja' };
  if (v > current) return { ok: false, reason: `wersja ${v} nowsza niż ${current}` };
  for (let n = v; n < current; n++) {
    const step = migrations[n];
    if (!step) return { ok: false, reason: `brak migracji ${n}→${n + 1}` };
    try {
      data = { ...step(data), version: n + 1 };
    } catch (e) {
      return { ok: false, reason: `migracja ${n}→${n + 1}: ${String(e)}` };
    }
  }
  return { ok: true, data, from: v };
}
