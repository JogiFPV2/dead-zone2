import { Color, MeshStandardMaterial, Vector3, type Object3D, type SkinnedMesh } from 'three';
import { MeshBuilder, type Ring, type Weights } from './mesh-builder.js';
import { attachSkinned, poseToBind, type BindPose } from './rig.js';

/**
 * New character bodies for the „Malowany” style (Paweł 24.11: new models from scratch): own
 * geometry built around the Quaternius skeleton in its bind pose, so every existing clip animates
 * it. Lofted body (torso, limbs, head) with clothes as part of the surface: shirt / jacket with a
 * collar, cuffs, breast pockets and a hem, trousers with a belt, thigh pockets and turn-ups,
 * shoes with soles and toe caps, hair, ears, nose, brows. Colours are vertex colours, so the
 * instanced zombies merge it into one draw like the old models.
 */

export interface BodySpec {
  skin: string;
  hair: string;
  /** Upper garment, its collar / pocket shade, and how far the sleeves reach (0 shoulder … 1 wrist). */
  top: string;
  topTrim: string;
  sleeve: number;
  /**
   * Jacket over a shirt of colour `under` (zip, collar); `long` = a coat to the knees;
   * `sleeveless` = a vest: the sleeves are the shirt's (`under`, `sleeve` long).
   */
  jacket?: { under: string; long?: boolean; sleeveless?: boolean };
  /**
   * Cut of the upper garment (without a jacket): `shirt` collar, placket and breast pockets (the
   * default), `tee` crew neck, `tank` undershirt, `pullover` rib collar (sweater, hoodie).
   */
  topCut?: 'shirt' | 'tee' | 'tank' | 'pullover';
  /** Hood on the back of the neck (hoodie). */
  hood?: boolean;
  /** Trouser length: 1 to the ankle (default), ~0.5 shorts to the knee, ~0.1 briefs; skin below. */
  legLength?: number;
  /** Shoe shaft above the ankle (m): boots, wellies; 0 / absent = low shoes. */
  boot?: number;
  /** No shoes: bare feet. */
  barefoot?: boolean;
  /** Gloves colour (hands and wrists); absent = bare hands. */
  gloves?: string;
  /** Worn on the head. */
  hat?: { kind: 'beanie' | 'cap' | 'hardhat'; color: string };
  /** Glasses (frame colour). */
  glasses?: string;
  /** Mask over the mouth and nose (colour). */
  mask?: string;
  /** No eyes, brows, nose, ears or mouth (garment icons). */
  noFace?: boolean;
  /** Tie (office shirt). */
  tie?: string;
  trousers: string;
  belt: string;
  shoes: string;
  sole: string;
  /** Hair: short crop or longer (to the neck). */
  hairStyle: 'short' | 'long' | 'bald';
  /** Body build: 1 = average; >1 broader. */
  build?: number;
  /** Zombie touches: dark stains (share of the surface), torn sleeve ends, sunken eyes. */
  zombie?: { stains: number; seed: number };
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Deterministic hash in [0, 1). */
function hash(a: number, b: number, c: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

export function buildBody(bp: BindPose, spec: BodySpec): MeshBuilder {
  const mb = new MeshBuilder();
  const col = (hex: string) => new Color(hex);
  const skin = col(spec.skin);
  const hair = col(spec.hair);
  const top = col(spec.top);
  const trim = col(spec.topTrim);
  const under = col(spec.jacket?.under ?? spec.top);
  const trousers = col(spec.trousers);
  const belt = col(spec.belt);
  const shoes = col(spec.shoes);
  const sole = col(spec.sole);
  const dark = new Color('#1d1714');
  const k = spec.build ?? 1;
  const B = (n: string) => bp.index(n);
  const at = (n: string) => bp.at(n);
  const one = (n: string): Weights => [[B(n), 1]];
  const mix = (a: string, b: string, t: number): Weights => [
    [B(a), 1 - t],
    [B(b), t],
  ];
  /** Stains on zombies: darker, reddish-brown blotches by position. */
  const stain = (c: Color, at: Vector3): Color => {
    const z = spec.zombie;
    if (!z) return c;
    const h = hash(Math.floor(at.x * 9) + z.seed, Math.floor(at.y * 7), Math.floor(at.z * 9));
    return h < z.stains ? c.clone().lerp(new Color('#3a1a14'), 0.55) : c;
  };

  // ---- Torso: hips to neck, elliptical sections, clothes as the surface.
  const hipsY = at('Hips').y;
  const chestY = at('Chest').y;
  const neckY = at('Neck').y;
  const cz = at('Chest').z;
  const torso = (y: number, a: number, b: number, color: Color, front = 0): Ring => {
    const w: Weights =
      y < at('Abdomen').y
        ? mix('Hips', 'Abdomen', (y - hipsY) / (at('Abdomen').y - hipsY))
        : y < at('Torso').y
          ? mix('Abdomen', 'Torso', (y - at('Abdomen').y) / (at('Torso').y - at('Abdomen').y))
          : y < chestY
            ? mix('Torso', 'Chest', (y - at('Torso').y) / (chestY - at('Torso').y))
            : mix('Chest', 'Neck', Math.min(1, Math.max(0, (y - chestY) / (neckY - chestY)) ** 2));
    const c = v3(0, y, cz - 0.005);
    return { c, u: X, a: a * k, v: Z, b: b * k, w, color: stain(color, c), n: 2.6, front };
  };
  const beltY = hipsY + 0.07;
  const hemY = spec.jacket ? beltY - 0.1 : beltY + 0.015;
  const upper = spec.jacket ? under : top;
  const cut = spec.topCut ?? 'shirt';
  const legLen = Math.min(1, Math.max(0.06, spec.legLength ?? 1));
  const hands = spec.gloves ? col(spec.gloves) : skin;
  // Trousers seat to belt, belt band, shirt / jacket up to the shoulders.
  mb.loft(
    [
      torso(hipsY - 0.1, 0.155, 0.1, trousers),
      torso(hipsY - 0.02, 0.165, 0.105, trousers),
      torso(beltY - 0.018, 0.158, 0.1, trousers),
      torso(beltY - 0.018, 0.163, 0.106, belt),
      torso(beltY + 0.018, 0.163, 0.106, belt),
      torso(beltY + 0.018, 0.152, 0.098, upper),
      torso(at('Abdomen').y + 0.06, 0.15, 0.1, upper, 0.008),
      torso(at('Torso').y + 0.05, 0.162, 0.105, upper, 0.012),
      torso(chestY - 0.02, 0.175, 0.105, upper, 0.01),
      torso(chestY + 0.06, 0.18, 0.095, upper),
      torso(neckY - 0.045, 0.14, 0.075, upper),
      torso(neckY - 0.01, 0.06, 0.05, upper),
    ],
    20,
    true,
    false,
  );
  if (spec.jacket) {
    // Open jacket: two front panels and the back as a slightly larger shell from the hem up,
    // the front gap shows the shirt.
    const shell = (y: number, a: number, b: number): Ring => torso(y, a + 0.012, b + 0.014, top);
    const rings = [
      shell(hemY, 0.165, 0.108),
      shell(beltY + 0.03, 0.158, 0.104),
      shell(at('Abdomen').y + 0.06, 0.155, 0.104),
      shell(at('Torso').y + 0.05, 0.166, 0.108),
      shell(chestY - 0.02, 0.178, 0.108),
      shell(chestY + 0.06, 0.183, 0.098),
      shell(neckY - 0.045, 0.145, 0.08),
    ];
    mb.loft(rings, 20, false, false);
    if (spec.jacket.long) {
      // Coat skirt from the hem to the knees, split between the legs by side.
      const kneeY = at('LowerLegL').y + 0.02;
      const legX = at('UpperLegL').x;
      const wAt = (q: Vector3): Weights => {
        const t = Math.min(1, Math.max(0, (hemY - q.y) / (hemY - kneeY)));
        const side = q.x >= 0 ? 'L' : 'R';
        const centre = Math.max(0, 1 - Math.abs(q.x) / legX) * 0.5;
        return [
          [B('Hips'), 0.75 - 0.35 * t + centre * 0.25],
          [B(`UpperLeg${side}`), 0.25 + 0.35 * t - centre * 0.25],
        ];
      };
      const skirt = (y: number, a: number, b: number): Ring => ({
        ...torso(y, a, b, top),
        wAt,
      });
      mb.loft(
        [
          skirt(hemY + 0.02, 0.177, 0.12),
          skirt(hemY - 0.12, 0.215, 0.13),
          skirt(kneeY + 0.08, 0.25, 0.14),
          skirt(kneeY, 0.26, 0.145),
        ],
        20,
      );
    }
    // Zip down the front and the shirt showing in the open collar.
    mb.box(
      v3(0, (hemY + chestY) / 2 + 0.03, cz + 0.12 * k + 0.004),
      [X, Y, Z],
      [0.006, (chestY - hemY) / 2 + 0.03, 0.004],
      trim,
      one('Torso'),
    );
    mb.box(
      v3(0, neckY - 0.06, cz + 0.085 * k),
      [X, Y, Z],
      [0.035, 0.035, 0.012],
      under,
      one('Chest'),
    );
    // Lapels: two flat collar flaps on the chest.
    for (const s of [-1, 1]) {
      mb.box(
        v3(s * 0.05, neckY - 0.07, cz + 0.095 * k + 0.012),
        [X, Y, Z],
        [0.022, 0.04, 0.008],
        trim,
        one('Chest'),
      );
    }
  } else if (cut === 'tee' || cut === 'tank' || cut === 'pullover') {
    // Crew neck / rib collar band (no placket); the undershirt has a deep neck.
    const neck = cut === 'tank' ? 0.07 : 0.035;
    mb.loft(
      [
        torso(neckY - neck - 0.012, cut === 'tank' ? 0.1 : 0.074, 0.064, trim),
        torso(neckY - neck + 0.006, cut === 'tank' ? 0.095 : 0.07, 0.06, trim),
      ],
      16,
    );
    if (spec.hood) {
      // Hood lying on the back of the neck and shoulders.
      mb.loft(
        [
          { ...torso(neckY - 0.06, 0.13, 0.03, top), c: v3(0, neckY - 0.06, cz - 0.085 * k) },
          { ...torso(neckY + 0.0, 0.11, 0.035, top), c: v3(0, neckY, cz - 0.09 * k) },
          { ...torso(neckY + 0.04, 0.07, 0.025, top), c: v3(0, neckY + 0.04, cz - 0.08 * k) },
        ],
        14,
        true,
        true,
      );
      // Kangaroo pocket.
      mb.box(
        v3(0, at('Abdomen').y + 0.03, cz + 0.104 * k),
        [X, Y, Z],
        [0.075, 0.045, 0.006],
        trim,
        one('Abdomen'),
      );
    }
  } else {
    if (spec.tie)
      mb.box(
        v3(0, chestY - 0.08, cz + 0.11 * k + 0.008),
        [X, Y, Z],
        [0.018, 0.13, 0.005],
        col(spec.tie),
        one('Chest'),
      );
    // Shirt collar ring and buttoned placket.
    mb.loft(
      [
        torso(neckY - 0.035, 0.075, 0.062, trim),
        torso(neckY + 0.005, 0.072, 0.06, trim),
        torso(neckY + 0.005, 0.058, 0.05, trim),
      ],
      16,
    );
    mb.box(
      v3(0, chestY - 0.06, cz + 0.105 * k + 0.004),
      [X, Y, Z],
      [0.012, 0.13, 0.004],
      trim,
      one('Chest'),
    );
  }
  // Breast pockets with flaps (shirts and jackets).
  for (const s of spec.jacket || cut === 'shirt' ? [-1, 1] : []) {
    const c = v3(s * 0.1 * k, chestY - 0.03, cz + 0.11 * k + (spec.jacket ? 0.016 : 0.004));
    mb.box(c, [X, Y, Z], [0.034, 0.04, 0.005], trim, one('Chest'));
    mb.box(c.clone().setY(c.y + 0.036), [X, Y, Z], [0.037, 0.01, 0.008], trim, one('Chest'));
  }

  // ---- Neck and head.
  const headY = at('Head').y;
  const hz = at('Head').z;
  const headW = (t: number): Weights => mix('Neck', 'Head', t);
  mb.loft(
    [
      {
        c: v3(0, neckY - 0.03, hz - 0.01),
        u: X,
        a: 0.056,
        v: Z,
        b: 0.054,
        w: headW(0),
        color: skin,
      },
      {
        c: v3(0, headY + 0.01, hz - 0.005),
        u: X,
        a: 0.048,
        v: Z,
        b: 0.048,
        w: headW(1),
        color: skin,
      },
    ],
    12,
  );
  const head = (dy: number, a: number, b: number, front: number, c = skin): Ring => ({
    c: v3(0, headY + dy, hz + 0.005),
    u: X,
    a,
    v: Z,
    b,
    w: one('Head'),
    color: c,
    front,
  });
  const H = 0.115; // half head height
  const bald = spec.hairStyle === 'bald';
  const scalp = bald ? skin : hair;
  mb.loft(
    [
      head(-0.035, 0.022, 0.025, 0.03),
      head(0.0, 0.042, 0.042, 0.025),
      head(0.02, 0.058, 0.06, 0.02), // jaw
      head(0.06, 0.07, 0.075, 0.015), // cheeks
      head(0.1, 0.078, 0.085, 0.01), // eyes
      head(0.14, 0.08, 0.088, 0.005, scalp),
      head(0.18, 0.074, 0.082, 0, scalp),
      head(0.215, 0.055, 0.062, 0, scalp),
      head(2 * H, 0.025, 0.03, 0, scalp),
    ],
    16,
    true,
    true,
  );
  if (!bald) {
    // Hair at the back / sides of the head (the scalp rings carry the top).
    const backLow = spec.hairStyle === 'long' ? -0.02 : 0.07;
    mb.loft(
      [
        {
          c: v3(0, headY + backLow, hz - 0.03),
          u: X,
          a: 0.076,
          v: Z,
          b: 0.065,
          w: one('Head'),
          color: hair,
        },
        {
          c: v3(0, headY + 0.14, hz - 0.01),
          u: X,
          a: 0.085,
          v: Z,
          b: 0.085,
          w: one('Head'),
          color: hair,
        },
      ],
      14,
      true,
    );
  }
  // Face: nose, brows, eyes, ears, mouth.
  const fz = hz + 0.005 + 0.085;
  if (!spec.noFace) {
    mb.box(v3(0, headY + 0.075, fz + 0.012), [X, Y, Z], [0.012, 0.022, 0.014], skin, one('Head'));
    const eye = spec.zombie ? new Color('#d8d2a0') : dark;
    for (const s of [-1, 1]) {
      mb.box(
        v3(s * 0.032, headY + 0.1, fz - 0.004),
        [X, Y, Z],
        [0.012, 0.007, 0.006],
        eye,
        one('Head'),
      );
      mb.box(
        v3(s * 0.033, headY + 0.118, fz - 0.002),
        [X, Y, Z],
        [0.018, 0.005, 0.008],
        bald ? dark : hair,
        one('Head'),
      );
      mb.box(v3(s * 0.08, headY + 0.09, hz), [X, Y, Z], [0.01, 0.022, 0.016], skin, one('Head'));
    }
    mb.box(
      v3(0, headY + 0.045, fz - 0.008),
      [X, Y, Z],
      [0.022, spec.zombie ? 0.009 : 0.004, 0.006],
      spec.zombie ? new Color('#2a0f0c') : skin.clone().multiplyScalar(0.7),
      one('Head'),
    );
  }

  // ---- Worn on the head: hat, glasses, mask.
  if (spec.hat) {
    const hc = col(spec.hat.color);
    const r = (dy: number, a: number, b: number): Ring => head(dy, a, b, 0, hc);
    if (spec.hat.kind === 'beanie')
      mb.loft(
        [
          r(0.105, 0.085, 0.093),
          r(0.135, 0.087, 0.095),
          r(0.14, 0.083, 0.091),
          r(0.19, 0.08, 0.088),
          r(0.228, 0.06, 0.068),
          r(0.25, 0.028, 0.034),
        ],
        16,
        true,
        true,
      );
    else {
      const hard = spec.hat.kind === 'hardhat';
      const g = hard ? 0.01 : 0;
      mb.loft(
        [
          r(0.125, 0.083 + g, 0.091 + g),
          r(0.18, 0.08 + g, 0.088 + g),
          r(0.222, 0.06 + g, 0.067 + g),
          r(0.245 + g, 0.03, 0.035),
        ],
        16,
        true,
        true,
      );
      if (hard)
        // Brim all round.
        mb.loft([r(0.118, 0.112, 0.12), r(0.13, 0.112, 0.12)], 16, true, true);
      // Peak forward.
      mb.box(
        v3(0, headY + (hard ? 0.124 : 0.13), hz + 0.005 + (hard ? 0.115 : 0.125)),
        [X, Y, Z],
        [hard ? 0.06 : 0.07, 0.005, hard ? 0.03 : 0.05],
        hc,
        one('Head'),
      );
    }
  }
  if (spec.glasses) {
    const gc = col(spec.glasses);
    for (const s of [-1, 1]) {
      mb.box(
        v3(s * 0.033, headY + 0.1, fz + 0.006),
        [X, Y, Z],
        [0.022, 0.015, 0.003],
        gc,
        one('Head'),
      );
      mb.box(
        v3(s * 0.08, headY + 0.105, hz + 0.04),
        [X, Y, Z],
        [0.003, 0.004, 0.05],
        gc,
        one('Head'),
      );
    }
    mb.box(v3(0, headY + 0.104, fz + 0.008), [X, Y, Z], [0.012, 0.003, 0.003], gc, one('Head'));
  }
  if (spec.mask)
    mb.box(
      v3(0, headY + 0.058, fz + 0.006),
      [X, Y, Z],
      [0.052, 0.034, 0.012],
      col(spec.mask),
      one('Head'),
    );

  // ---- Arms (T-pose along ±x): shoulder cap, sleeve to `sleeve`, skin below, hands.
  for (const s of [-1, 1] as const) {
    const side = s > 0 ? 'L' : 'R';
    const sh = at(`UpperArm${side}`);
    const el = at(`LowerArm${side}`);
    const wr = at(`Wrist${side}`);
    const ax = s > 0 ? X : X.clone().negate();
    // Ring frame for a limb along ±x: width along z (front), depth along y; v = ax × u keeps
    // the winding outwards on both sides.
    const u = Z;
    const v = new Vector3().crossVectors(ax, u).negate();
    const along = (t: number) =>
      t < 0.5 ? sh.clone().lerp(el, t * 2) : el.clone().lerp(wr, (t - 0.5) * 2);
    const armW = (t: number): Weights =>
      t < 0.42
        ? mix(`UpperArm${side}`, `LowerArm${side}`, 0)
        : t < 0.58
          ? mix(`UpperArm${side}`, `LowerArm${side}`, (t - 0.42) / 0.16)
          : t < 0.92
            ? one(`LowerArm${side}`)
            : mix(`LowerArm${side}`, `Wrist${side}`, (t - 0.92) / 0.08);
    const r = (t: number) => (0.058 - 0.026 * t) * k;
    const ring = (t: number, color: Color, grow = 0): Ring => {
      const c = along(t);
      return { c, u, a: r(t) + grow, v, b: r(t) * 0.9 + grow, w: armW(t), color: stain(color, c) };
    };
    const sl = Math.max(0.12, Math.min(1, spec.sleeve));
    // A vest's sleeves are the shirt under it.
    const sleeveCol = spec.jacket?.sleeveless ? under : top;
    const torn = spec.zombie ? 0.03 * (hash(s, spec.zombie.seed, 3) - 0.5) : 0;
    const rings: Ring[] = [
      {
        ...ring(0, sleeveCol, 0.002),
        c: sh
          .clone()
          .addScaledVector(ax, -0.05)
          .setY(sh.y - 0.025),
      },
      ring(0, sleeveCol, 0.01),
      ring(Math.min(0.3, sl * 0.5), sleeveCol, 0.008),
    ];
    if (sl > 0.55) rings.push(ring(0.5, sleeveCol, 0.008));
    rings.push(ring(sl + torn - 0.03, sleeveCol, 0.01), ring(sl + torn, sleeveCol, 0.012));
    // Cuff edge back to skin.
    rings.push(ring(sl + torn, skin), ring(Math.min(1, sl + torn + 0.02), skin));
    if (sl + torn < 0.5) rings.push(ring(0.5, skin));
    if (spec.gloves && sl + torn < 0.9)
      rings.push(ring(0.9, skin), ring(0.9, hands, 0.006), ring(0.97, hands, 0.004));
    else rings.push(ring(0.97, skin));
    rings.push(ring(1, hands));
    mb.loft(rings, 12, true, false);
    // Hand: palm block and finger block (bends with the middle finger), thumb.
    const hw: Weights = one(`Wrist${side}`);
    const palm = wr.clone().addScaledVector(ax, 0.045);
    mb.box(palm, [ax, Y, Z], [0.05, 0.02, 0.048], hands, hw);
    mb.box(
      wr.clone().addScaledVector(ax, 0.12),
      [ax, Y, Z],
      [0.042, 0.017, 0.045],
      hands,
      mix(`Wrist${side}`, `Middle2${side}`, 0.7),
    );
    mb.box(
      wr.clone().addScaledVector(ax, 0.05).addScaledVector(Z, 0.05),
      [ax, Y, Z],
      [0.03, 0.013, 0.014],
      hands,
      mix(`Wrist${side}`, `Thumb2${side}`, 0.6),
    );
  }

  // ---- Legs: trousers to the ankle with pockets and turn-ups, shoes.
  for (const s of [-1, 1] as const) {
    const side = s > 0 ? 'L' : 'R';
    const hip = at(`UpperLeg${side}`);
    const knee = at(`LowerLeg${side}`);
    const foot = at(`Foot${side}`);
    const ankle = v3(knee.x, foot.y + 0.085, foot.z - 0.01);
    // Thighs start a little inside the hip joints (closes the crotch gap).
    const hipIn = hip.clone().setX(hip.x * 0.82);
    const along = (t: number) =>
      t < 0.5 ? hipIn.clone().lerp(knee, t * 2) : knee.clone().lerp(ankle, (t - 0.5) * 2);
    const legW = (t: number): Weights =>
      t < 0.08
        ? mix('Hips', `UpperLeg${side}`, 0.5 + t * 6)
        : t < 0.42
          ? one(`UpperLeg${side}`)
          : t < 0.58
            ? mix(`UpperLeg${side}`, `LowerLeg${side}`, (t - 0.42) / 0.16)
            : t < 0.95
              ? one(`LowerLeg${side}`)
              : mix(`LowerLeg${side}`, `Foot${side}`, (t - 0.95) / 0.05);
    const r = (t: number) => (t < 0.5 ? 0.1 - 0.04 * t * 2 : 0.06 - 0.014 * (t - 0.5) * 2) * k;
    // Legs run down (-y): u = x, v = z gives outward winding for a loft going downwards? the
    // rings go top → bottom, so swap to keep faces outwards.
    const ring = (t: number, color: Color, grow = 0): Ring => {
      const c = along(t);
      return {
        c,
        u: Z,
        a: r(t) * 0.95 + grow,
        v: X,
        b: r(t) + grow,
        w: legW(t),
        color: stain(color, c),
      };
    };
    const top0: Ring = {
      ...ring(0, trousers, 0.004),
      c: hip
        .clone()
        .setY(hip.y + 0.04)
        .setX(hip.x * 0.7),
    };
    // Boots: trousers tucked in (no turn-up), the shaft drawn over them below.
    const shaft = spec.barefoot ? 0 : (spec.boot ?? 0);
    const legRings: Ring[] =
      legLen >= 0.95
        ? shaft > 0.03
          ? [
              top0,
              ring(0.05, trousers, 0.004),
              ring(0.25, trousers, 0.003),
              ring(0.5, trousers, 0.004),
              ring(0.75, trousers, 0.002),
              ring(0.99, trousers, -0.004),
            ]
          : [
              top0,
              ring(0.05, trousers, 0.004),
              ring(0.25, trousers, 0.003),
              ring(0.5, trousers, 0.004),
              ring(0.75, trousers, 0.006),
              ring(0.93, trousers, 0.01),
              ring(0.93, trousers, 0.016),
              ring(0.99, trousers, 0.016),
              ring(0.99, trousers, 0.004),
            ]
        : [
            // Shorts / briefs: a hem at `legLen`, bare leg below to the ankle.
            top0,
            ...[0.05, 0.25].filter((t) => t < legLen - 0.03).map((t) => ring(t, trousers, 0.004)),
            ring(legLen, trousers, 0.008),
            ring(legLen, skin, -0.004),
            ...[0.25, 0.5, 0.75].filter((t) => t > legLen + 0.03).map((t) => ring(t, skin, -0.006)),
            ring(0.99, skin, -0.012),
          ];
    mb.loft(legRings, 14, false, true);
    // Boot shaft from the shoe up the shin.
    if (shaft > 0) {
      const shin = (h: number, grow: number): Ring => {
        const c = ankle.clone().lerp(knee, Math.min(0.9, h / ankle.distanceTo(knee)));
        return {
          c,
          u: Z,
          a: 0.056 * k + grow,
          v: X,
          b: 0.058 * k + grow,
          w: mix(`LowerLeg${side}`, `Foot${side}`, h < 0.03 ? 0.5 : 0),
          color: shoes,
        };
      };
      mb.loft([shin(-0.02, 0.014), shin(shaft, 0.018), shin(shaft, 0.006)], 12, false, true);
    }
    // Side thigh pockets (cargo, long trousers only).
    if (legLen >= 0.95)
      mb.box(
        along(0.3).addScaledVector(X, s * (r(0.3) + 0.003)),
        [X, Y, Z],
        [0.004, 0.05, 0.04],
        trousers.clone().multiplyScalar(0.85),
        one(`UpperLeg${side}`),
      );
    // Shoe: heel to toe along +z, a sole slab, a toe cap.
    const fw = one(`Foot${side}`);
    const shoe = (z: number, a: number, h: number, y0: number, c: Color): Ring => ({
      c: v3(foot.x, y0 + h / 2, foot.z + z),
      u: X,
      a,
      v: Y,
      b: h / 2,
      w: fw,
      color: c,
      n: 3,
    });
    if (spec.barefoot) {
      // Bare foot: a slimmer foot shape in skin, toes at the front.
      mb.loft(
        [
          shoe(-0.06, 0.036, 0.08, 0.0, skin),
          shoe(-0.01, 0.04, 0.08, 0.0, skin),
          shoe(0.06, 0.042, 0.055, 0.0, skin),
          shoe(0.13, 0.038, 0.035, 0.0, skin),
        ],
        12,
        true,
        true,
      );
    } else {
      mb.loft(
        [
          shoe(-0.07, 0.042, 0.09, 0.02, shoes),
          shoe(-0.02, 0.048, 0.1, 0.02, shoes),
          shoe(0.05, 0.05, 0.075, 0.02, shoes),
          shoe(0.11, 0.048, 0.055, 0.02, shoes),
          shoe(0.15, 0.04, 0.045, 0.02, shoes),
        ],
        12,
        true,
        true,
      );
      mb.box(v3(foot.x, 0.012, foot.z + 0.04), [X, Y, Z], [0.05, 0.012, 0.112], sole, fw);
    }
  }
  return mb;
}

/** One painted body material (vertex colours; the colour is white). */
export function bodyMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
}

/**
 * Replaces the skinned meshes of a loaded Quaternius character (`root`, as `kit.character`
 * returns it, before any baking) with a new body of `spec`. Clips keep working.
 */
export function rebuildCharacter(root: Object3D, spec: BodySpec): SkinnedMesh {
  const old: SkinnedMesh[] = [];
  let holder: Object3D | undefined;
  root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (m.isSkinnedMesh) {
      old.push(m);
      holder ??= m.parent ?? undefined;
    }
  });
  const bp = frozenBind(poseToBind(glbScene(root, holder ?? root)));
  const mesh = attachSkinned(bp, buildBody(bp, spec).build(), bodyMaterial(), 'painted-body');
  mesh.userData.paintedBind = bp;
  for (const m of old) m.removeFromParent();
  return mesh;
}

/** Bind positions read once (the skeleton moves with the clips afterwards). */
function frozenBind(bp: BindPose): BindPose {
  const at = new Map<string, Vector3>();
  for (const b of bp.bones) at.set(b.name, bp.at(b.name));
  return {
    root: bp.root,
    bones: bp.bones,
    index: bp.index,
    at: (name) => {
      const v = at.get(name);
      if (!v) throw new Error(`no bone ${name}`);
      return v.clone();
    },
  };
}

/**
 * Dresses an already rebuilt character (`rebuildCharacter`) in `spec` while it animates: swaps
 * the body geometry (same bones, same bind), also under its outline hull. False = no painted
 * body on `root`.
 */
export function redressCharacter(root: Object3D, spec: BodySpec): boolean {
  const mesh = root.getObjectByName('painted-body') as SkinnedMesh | undefined;
  const bp = mesh?.userData.paintedBind as BindPose | undefined;
  if (!mesh || !bp) return false;
  const old = mesh.geometry;
  const geometry = buildBody(bp, spec).build();
  mesh.geometry = geometry;
  for (const c of mesh.children) {
    const h = c as SkinnedMesh;
    if (h.isSkinnedMesh && h.geometry === old) h.geometry = geometry;
  }
  old.dispose();
  return true;
}

/**
 * The glTF scene object (metres, y up): the child of `root` (the `fitted` wrap) on the way up
 * from the skinned parts' parent, or `root` itself when it is the scene.
 */
function glbScene(root: Object3D, holder: Object3D): Object3D {
  let o = holder;
  while (o.parent && o.parent !== root) o = o.parent;
  return o.parent === root ? o : root;
}

export const SURVIVOR: BodySpec = {
  skin: '#d6a27c',
  hair: '#3a281c',
  top: '#5e6a40',
  topTrim: '#4c5634',
  sleeve: 0.95,
  jacket: { under: '#c9c1a8' },
  trousers: '#2f3b55',
  belt: '#2a1f17',
  shoes: '#4e3624',
  sole: '#1e1a17',
  hairStyle: 'short',
};

export const ZOMBIE_TRACKSUIT: BodySpec = {
  skin: '#93a07e',
  hair: '#2a2420',
  top: '#7b2b2e',
  topTrim: '#e6e1d4',
  sleeve: 1,
  jacket: { under: '#d8d2c4' },
  trousers: '#2c3047',
  belt: '#2c3047',
  shoes: '#d9d6cf',
  sole: '#8f8a84',
  hairStyle: 'bald',
  build: 0.96,
  zombie: { stains: 0.18, seed: 11 },
};

export const ZOMBIE_COAT: BodySpec = {
  skin: '#a3a88a',
  hair: '#5a3d26',
  top: '#6e5a45',
  topTrim: '#5c4a38',
  sleeve: 0.97,
  jacket: { under: '#b9a99a', long: true },
  trousers: '#3b3a3e',
  belt: '#3b3a3e',
  shoes: '#231d1a',
  sole: '#120f0d',
  hairStyle: 'long',
  build: 0.92,
  zombie: { stains: 0.2, seed: 23 },
};

export const ZOMBIE_OFFICE: BodySpec = {
  skin: '#9aa585',
  hair: '#1f1a17',
  top: '#d4d2c8',
  topTrim: '#bdbab0',
  sleeve: 1,
  tie: '#2f3d63',
  trousers: '#4a4c52',
  belt: '#1c1916',
  shoes: '#1a1715',
  sole: '#0e0c0b',
  hairStyle: 'short',
  zombie: { stains: 0.26, seed: 37 },
};

export const ZOMBIE_WORKER: BodySpec = {
  skin: '#8d9a76',
  hair: '#2c261f',
  top: '#5f7286',
  topTrim: '#4f6072',
  sleeve: 0.42,
  trousers: '#5a4836',
  belt: '#231b14',
  shoes: '#2e2722',
  sole: '#151210',
  hairStyle: 'short',
  build: 1.04,
  zombie: { stains: 0.22, seed: 3 },
};

/** Zombie bodies, one per instanced template. */
export const ZOMBIE_BODIES: readonly BodySpec[] = [
  ZOMBIE_WORKER,
  ZOMBIE_TRACKSUIT,
  ZOMBIE_COAT,
  ZOMBIE_OFFICE,
];
