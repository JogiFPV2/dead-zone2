import type { BodySpec } from './body.js';

/**
 * What the player wears → the painted body (Paweł 25.11: the character on screen is dressed in
 * exactly the clothes worn in the inventory). Each clothing item has a garment look here: its
 * cut and default colours; the item's `tint` (creator colours) replaces them. Unknown clothing
 * (mods) falls back to a plain garment of its slot. Nothing worn = underwear (undershirt and
 * briefs, Paweł 25.11: underwear cannot be taken off).
 */

/** Worn clothing item: content id and colours (`ItemView.tint`). */
export interface WornItem {
  def: string;
  tint?: readonly string[] | undefined;
}

/** Worn clothes by equip slot (only the clothing slots matter here). */
export type WornClothes = Partial<
  Record<'head' | 'face' | 'torso_inner' | 'torso_outer' | 'hands' | 'legs' | 'feet', WornItem>
>;

/** Body without clothes: skin, hair and the hair cut (from the creator). */
export interface BaseLook {
  skin: string;
  hair: string;
  hairStyle: BodySpec['hairStyle'];
  build?: number;
}

type Inner = { kind: 'inner'; cut: 'tee' | 'shirt'; sleeve: number; color: string; trim: string };
type Outer = {
  kind: 'outer';
  /** open = jacket over the shirt; pullover = closed (sweater, hoodie). */
  open: boolean;
  long?: boolean;
  sleeveless?: boolean;
  hood?: boolean;
  color: string;
  trim: string;
};
type Legs = { kind: 'legs'; length: number; color: string; belt: boolean };
type Feet = { kind: 'feet'; color: string; sole: string; boot: number };
type Hands = { kind: 'hands'; color: string };
type Head = { kind: 'head'; hat: 'beanie' | 'cap' | 'hardhat'; color: string };
type Face = { kind: 'face'; face: 'glasses' | 'mask'; color: string };
export type Garment = Inner | Outer | Legs | Feet | Hands | Head | Face;

/** Garment looks of the base clothing items (`items/clothing-*.json`). */
export const GARMENTS: Readonly<Record<string, Garment>> = {
  'base:t-shirt': { kind: 'inner', cut: 'tee', sleeve: 0.42, color: '#d6d1c4', trim: '#c4bfb2' },
  'base:flannel-shirt': {
    kind: 'inner',
    cut: 'shirt',
    sleeve: 1,
    color: '#8a4b32',
    trim: '#6e3a27',
  },
  'base:hoodie': { kind: 'outer', open: false, hood: true, color: '#4b5259', trim: '#3d434a' },
  'base:sweater': { kind: 'outer', open: false, color: '#5c2a2c', trim: '#4a2123' },
  'base:track-jacket': { kind: 'outer', open: true, color: '#28324a', trim: '#d6d1c4' },
  'base:jacket': { kind: 'outer', open: true, color: '#34473a', trim: '#2a392f' },
  'base:work-jacket': { kind: 'outer', open: true, color: '#46597a', trim: '#384862' },
  'base:vest': { kind: 'outer', open: true, sleeveless: true, color: '#5b5e3a', trim: '#4a4c2f' },
  'base:raincoat': { kind: 'outer', open: true, long: true, color: '#a8893a', trim: '#8c722f' },
  'base:jeans': { kind: 'legs', length: 1, color: '#46597a', belt: true },
  'base:cargo-pants': { kind: 'legs', length: 1, color: '#4a5236', belt: true },
  'base:shorts': { kind: 'legs', length: 0.45, color: '#9a8f6a', belt: true },
  'base:work-pants': { kind: 'legs', length: 1, color: '#28324a', belt: true },
  'base:sweatpants': { kind: 'legs', length: 1, color: '#2f3133', belt: false },
  'base:chinos': { kind: 'legs', length: 1, color: '#a88b67', belt: true },
  'base:sneakers': { kind: 'feet', color: '#d6d1c4', sole: '#7a7c7e', boot: 0 },
  'base:boots': { kind: 'feet', color: '#5e4632', sole: '#1e1a17', boot: 0.06 },
  'base:work-boots': { kind: 'feet', color: '#3b2a20', sole: '#151210', boot: 0.1 },
  'base:hiking-boots': { kind: 'feet', color: '#5e4632', sole: '#2f3133', boot: 0.07 },
  'base:rubber-boots': { kind: 'feet', color: '#34473a', sole: '#1e1a17', boot: 0.25 },
  'base:gloves': { kind: 'hands', color: '#5a5446' },
  'base:beanie': { kind: 'head', hat: 'beanie', color: '#2f3133' },
  'base:baseball-cap': { kind: 'head', hat: 'cap', color: '#28324a' },
  'base:hard-hat': { kind: 'head', hat: 'hardhat', color: '#d9a82a' },
  'base:glasses': { kind: 'face', face: 'glasses', color: '#1f1b19' },
  'base:dust-mask': { kind: 'face', face: 'mask', color: '#e8e6df' },
};

/** Plain garment per slot for clothing without a look (mods). */
const BY_SLOT: Readonly<Record<keyof WornClothes, Garment>> = {
  head: GARMENTS['base:beanie']!,
  face: GARMENTS['base:glasses']!,
  torso_inner: GARMENTS['base:t-shirt']!,
  torso_outer: GARMENTS['base:jacket']!,
  hands: GARMENTS['base:gloves']!,
  legs: GARMENTS['base:jeans']!,
  feet: GARMENTS['base:sneakers']!,
};

export const UNDERSHIRT = '#e4e0d6';
export const BRIEFS = '#3e4a63';

const darker = (hex: string, k = 0.82): string => {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) =>
    Math.round(((n >> s) & 255) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
};

/** Garment of a worn item with its colours (tint[0] main, tint[1] trim / sole). */
export function garmentOf(slot: keyof WornClothes, w: WornItem): Garment {
  const g = GARMENTS[w.def] ?? BY_SLOT[slot];
  const main = w.tint?.[0];
  const second = w.tint?.[1];
  if (main === undefined) return g;
  switch (g.kind) {
    case 'inner':
    case 'outer':
      return { ...g, color: main, trim: second ?? darker(main) };
    case 'feet':
      return { ...g, color: main, sole: second ?? g.sole };
    default:
      return { ...g, color: main };
  }
}

/** Painted body of a character with `base` look wearing `worn`. */
export function dressedBody(base: BaseLook, worn: WornClothes): BodySpec {
  const pick = <K extends Garment['kind']>(slot: keyof WornClothes, kind: K) => {
    const w = worn[slot];
    const g = w && garmentOf(slot, w);
    return g?.kind === kind ? (g as Extract<Garment, { kind: K }>) : undefined;
  };
  const inner = pick('torso_inner', 'inner');
  const outer = pick('torso_outer', 'outer');
  const legs = pick('legs', 'legs');
  const feet = pick('feet', 'feet');
  const hands = pick('hands', 'hands');
  const head = pick('head', 'head');
  const face = pick('face', 'face');
  const shirt = inner ?? {
    kind: 'inner' as const,
    cut: 'tank' as const,
    sleeve: 0.12,
    color: UNDERSHIRT,
    trim: darker(UNDERSHIRT, 0.9),
  };
  const spec: BodySpec = {
    skin: base.skin,
    hair: base.hair,
    hairStyle: base.hairStyle,
    top: shirt.color,
    topTrim: shirt.trim,
    sleeve: shirt.sleeve,
    topCut: shirt.cut,
    trousers: legs?.color ?? BRIEFS,
    belt: legs?.belt ? '#2a1f17' : (legs?.color ?? BRIEFS),
    legLength: legs?.length ?? 0.1,
    shoes: feet?.color ?? base.skin,
    sole: feet?.sole ?? base.skin,
    boot: feet?.boot ?? 0,
    barefoot: !feet,
  };
  if (base.build !== undefined) spec.build = base.build;
  if (outer?.open) {
    spec.jacket = { under: shirt.color };
    if (outer.long) spec.jacket.long = true;
    if (outer.sleeveless) spec.jacket.sleeveless = true;
    spec.top = outer.color;
    spec.topTrim = outer.trim;
    if (!outer.sleeveless) spec.sleeve = 0.97;
  } else if (outer) {
    spec.top = outer.color;
    spec.topTrim = outer.trim;
    spec.sleeve = 1;
    spec.topCut = 'pullover';
    if (outer.hood) spec.hood = true;
  }
  if (hands) spec.gloves = hands.color;
  if (head) spec.hat = { kind: head.hat, color: head.color };
  if (face?.face === 'glasses') spec.glasses = face.color;
  if (face?.face === 'mask') spec.mask = face.color;
  return spec;
}

/** Long-haired creator heads (the painted body knows short / long / bald). */
const LONG = new Set([
  'base:head-long',
  'base:head-ponytail',
  'base:head-bun',
  'base:head-curly',
  'base:head-messy',
]);

/** Painted hair cut of a creator head part. */
export function hairStyleOf(headPart: string | undefined): BodySpec['hairStyle'] {
  if (headPart === 'base:head-bald') return 'bald';
  return headPart !== undefined && LONG.has(headPart) ? 'long' : 'short';
}

/** Stable key of what is worn (rebuild the body only when it changes). */
export function wornKey(worn: WornClothes): string {
  return Object.keys(worn)
    .sort()
    .map((k) => {
      const w = worn[k as keyof WornClothes]!;
      return `${k}=${w.def}:${w.tint?.join('/') ?? ''}`;
    })
    .join('|');
}
