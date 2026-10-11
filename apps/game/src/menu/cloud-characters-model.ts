/**
 * Pure helpers of the online Postacie screen (deadzone-hud-v2-spec „Ekran Postacie online”,
 * mockup characters-online.png): API fields → card texts.
 */
import type { AccountUsage, AccountUser, CloudCharacter } from '../account/account-api.js';
import type { Portrait } from '../characters/schema.js';
import { MONTHS, daysLabel, feminine, playedLabel, type CardAction } from './characters-model.js';

const MiB = 1024 * 1024;

/** `1,8` below 10 MB, whole numbers from 10 MB (spec: bytes / 1 048 576). */
export function mbNumber(bytes: number): string {
  const mb = Math.max(0, bytes) / MiB;
  return mb < 10 ? mb.toFixed(1).replace('.', ',') : String(Math.round(mb));
}
export const mbLabel = (bytes: number): string => `${mbNumber(bytes)} MB`;
/** `12 / 50 MB`. */
export const usageLabel = (u: Pick<AccountUsage, 'usedBytes' | 'limitBytes'>): string =>
  `${mbNumber(u.usedBytes)} / ${mbNumber(u.limitBytes)} MB`;

export const usageFraction = (used: number, limit: number): number =>
  limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;

/** Storage bar colour: accent, from 80 % `#E8CD7A`, from 95 % `#E8766C` [ZAŁ.]. */
export function usageColor(fraction: number): string {
  if (fraction >= 0.95) return '#E8766C';
  if (fraction >= 0.8) return '#E8CD7A';
  return '#E0A23A';
}

/** `2 paź 2026`. */
export function dateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

/** Living by `lastPlayedAt` (newest first), then tombstones by `diedAt` [ZAŁ.]. */
export function sortCloud(chars: readonly CloudCharacter[]): CloudCharacter[] {
  const alive = chars.filter((c) => c.status === 'alive');
  const dead = chars.filter((c) => c.status !== 'alive');
  alive.sort((a, b) => time(b.lastPlayedAt) - time(a.lastPlayedAt));
  dead.sort((a, b) => time(b.diedAt) - time(a.diedAt));
  return [...alive, ...dead];
}

/** Feminine forms from `appearance.sex` [ZAŁ.], else from the first name. */
export function isFemale(c: Pick<CloudCharacter, 'name' | 'appearance'>): boolean {
  const sex = c.appearance.sex;
  if (sex === 'female') return true;
  if (sex === 'male') return false;
  return feminine(c.name);
}

const HEX = /^#[0-9a-f]{3,8}$/i;
const FALLBACK: Portrait = { skin: '#b9876a', hair: '#2a2420', shirt: '#4a5a48' };

type PartColors = { primary?: string | undefined };
type PartChoice = { colors?: PartColors | undefined };
type PartsBag = Record<string, PartChoice | undefined>;

const hexColor = (v: unknown): string | undefined =>
  typeof v === 'string' && HEX.test(v) ? v : undefined;

/** `appearance.parts` or `appearance.spec.appearance.parts` (CharacterSpec on the cloud). */
function appearanceParts(appearance: Record<string, unknown>): PartsBag | undefined {
  const direct = appearance.parts;
  if (direct && typeof direct === 'object') return direct as PartsBag;
  const spec = appearance.spec;
  if (!spec || typeof spec !== 'object') return undefined;
  const inner = (spec as { appearance?: { parts?: unknown } }).appearance?.parts;
  return inner && typeof inner === 'object' ? (inner as PartsBag) : undefined;
}

/**
 * Card portrait colours. Prefers the stored `portrait` hexes; hair falls back to the content
 * slot colour — `parts.head.colors.primary` after #38, else legacy `parts.hair.colors.primary`.
 */
export function portraitOfCloud(c: Pick<CloudCharacter, 'appearance'>): Portrait {
  const a = c.appearance;
  const p = a.portrait as Partial<Record<keyof Portrait, unknown>> | undefined;
  const pick = (k: keyof Portrait): string => hexColor(p?.[k]) ?? FALLBACK[k];
  const parts = appearanceParts(a);
  const hairFromParts =
    hexColor(parts?.head?.colors?.primary) ?? hexColor(parts?.hair?.colors?.primary);
  return {
    skin: pick('skin'),
    hair: hexColor(p?.hair) ?? hairFromParts ?? FALLBACK.hair,
    shirt: pick('shirt'),
  };
}

const km = (m: number): string => (m / 1000).toFixed(1).replace('.', ',');

/**
 * `Wolnogród · dzień 12`; without a settlement (Serwer #157 sends `place: null` for now) the
 * position on the map in km: `4,2 · 6,6 km · dzień 12`. No `lastLocation` → undefined (`—`).
 */
export function locationLabel(c: Pick<CloudCharacter, 'lastLocation'>): string | undefined {
  const l = c.lastLocation;
  if (!l) return undefined;
  const where = l.place?.trim() ? l.place.trim() : `${km(l.x)} · ${km(l.y)} km`;
  return `${where} · dzień ${l.day}`;
}

export type CloudBadge = 'cloud' | 'sync' | undefined;

export interface CloudCardView {
  readonly id: string;
  readonly name: string;
  readonly sub: string;
  readonly dead: boolean;
  readonly portrait: Portrait;
  readonly daysLabel: string;
  readonly days: string;
  /** Living: location (undefined → `—`); tombstone: date of death. */
  readonly location?: string | undefined;
  readonly died?: string | undefined;
  readonly played: string;
  readonly save: string;
  readonly badge: CloudBadge;
  /** Save or load in flight: Graj → `CZEKAJ…`. */
  readonly busy: boolean;
  readonly actions: readonly CardAction[];
}

export function cloudCardView(c: CloudCharacter, now: number, syncing: boolean): CloudCardView {
  const fem = isFemale(c);
  const dead = c.status !== 'alive';
  const sub = dead
    ? `${fem ? 'MARTWA' : 'MARTWY'} · NAGROBEK`
    : `${fem ? 'ŻYWA' : 'ŻYWY'}${c.daysSurvived === 0 ? ' · NOWA' : ''}`;
  return {
    id: c.id,
    name: c.name,
    sub,
    dead,
    portrait: portraitOfCloud(c),
    daysLabel: fem ? 'PRZEŻYŁA' : 'PRZEŻYŁ',
    days: daysLabel(c.daysSurvived),
    location: dead ? undefined : locationLabel(c),
    died: dead && c.diedAt ? dateLabel(c.diedAt) : undefined,
    played: c.lastPlayedAt ? playedLabel(Date.parse(c.lastPlayedAt), now) : '—',
    save: dead ? 'usunięty' : c.save ? mbLabel(c.save.sizeBytes) : '—',
    badge: dead ? undefined : syncing ? 'sync' : c.save ? 'cloud' : undefined,
    busy: !dead && syncing,
    actions: dead ? ['delete'] : ['play', 'delete'],
  };
}

/** `1 miejsce`, `3 miejsca`, `17 miejsc`. */
/** Polish „few” form (2–4, 22–24 …, not 12–14). */
const few = (n: number): boolean => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);

export function placesLabel(n: number): string {
  return `${n} ${n === 1 ? 'miejsce' : few(n) ? 'miejsca' : 'miejsc'}`;
}

/** „Nowa postać” suffix and whether it is disabled (limit of living characters, full storage). */
export function newCharacterState(u: AccountUsage): { disabled: boolean; note: string } {
  if (u.alive >= u.aliveLimit) {
    return { disabled: true, note: `· limit ${u.aliveLimit} żywych postaci` };
  }
  if (u.usedBytes >= u.limitBytes) return { disabled: true, note: '· brak miejsca na koncie' };
  const left = u.aliveLimit - u.alive;
  return { disabled: false, note: `· ${few(left) ? 'zostały' : 'zostało'} ${placesLabel(left)}` };
}

/** Avatar initials: `pawel.rosol@…` → `PR`, `jan@…` → `JA`. */
export function initials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._\-+]+/).filter(Boolean);
  const s = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : (parts[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}

export const methodLabel = (u: Pick<AccountUser, 'method'>): string =>
  u.method === 'google' ? 'GOOGLE' : 'E-MAIL';
