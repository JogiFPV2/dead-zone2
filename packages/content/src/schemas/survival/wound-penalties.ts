import { z } from 'zod';
import { frac, stat } from './num.js';

/** Grupy części ciała dla kar z ran (`BODY_PARTS` z `protocol` mapuje `bodyGroups`). */
export const BODY_GROUPS = ['head', 'torso', 'arm', 'leg'] as const;
export const BodyGroupSchema = z.enum(BODY_GROUPS);
export const WoundSeveritySchema = z.enum(['light', 'heavy']);

const PARTS: Record<string, (typeof BODY_GROUPS)[number]> = {
  head: 'head',
  neck: 'head',
  torso_upper: 'torso',
  torso_lower: 'torso',
  groin: 'torso',
  ...Object.fromEntries(
    ['upper_arm', 'forearm', 'hand'].flatMap((p) => [`${p}_l`, `${p}_r`]).map((p) => [p, 'arm']),
  ),
  ...Object.fromEntries(
    ['thigh', 'shin', 'foot'].flatMap((p) => [`${p}_l`, `${p}_r`]).map((p) => [p, 'leg']),
  ),
};

/** Kara jako ułamek utraty (0.15 = −15%): ruch, siła ataku, tempo akcji, zasięg widzenia. */
const penalty = (moveSpeed: number, attackPower: number, actionSpeed: number, vision = 0) =>
  z
    .strictObject({
      moveSpeed: frac(moveSpeed),
      attackPower: frac(attackPower),
      actionSpeed: frac(actionSpeed),
      visionRange: frac(vision),
    })
    .prefault({});

const table = (l: number[], a: number[], t: number[], h: number[]) =>
  z
    .strictObject({
      leg: penalty(l[0]!, l[1]!, l[2]!),
      arm: penalty(a[0]!, a[1]!, a[2]!),
      torso: penalty(t[0]!, t[1]!, t[2]!),
      head: penalty(h[0]!, h[1]!, h[2]!, h[3]),
    })
    .prefault({});

/** Stan (ból, gorączka, krwawienie) od progu zmniejsza widzenie; `blur` to osobne rozmycie obrazu. */
const condition = (from: number, visionRange: number, blur: number) =>
  z
    .strictObject({ from: stat(from), visionRange: frac(visionRange), blur: frac(blur) })
    .prefault({});

/**
 * Kary z ran: rodzaj rany → ciężkość (`severity`), część ciała → grupa (`bodyGroups`), tabela
 * `light`/`heavy` × grupa. W grupie liczy się najcięższa rana; grupy się sumują, suma każdej kary
 * jest ucinana do `maxPenalty`. Opatrzona rana daje karę × `bandagedFactor`.
 */
export const WoundPenaltiesSchema = z
  .strictObject({
    severity: z
      .strictObject({
        scratch: WoundSeveritySchema.default('light'),
        laceration: WoundSeveritySchema.default('light'),
        bite: WoundSeveritySchema.default('heavy'),
        deep: WoundSeveritySchema.default('heavy'),
      })
      .prefault({}),
    bodyGroups: z.record(z.string(), BodyGroupSchema).default(PARTS),
    light: table([0.15, 0, 0.05], [0, 0.15, 0.1], [0.05, 0.05, 0.05], [0, 0, 0.05, 0.1]),
    heavy: table(
      [0.35, 0.05, 0.1],
      [0.05, 0.35, 0.25],
      [0.15, 0.15, 0.15],
      [0.05, 0.05, 0.1, 0.25],
    ),
    bandagedFactor: frac(0.5),
    maxPenalty: frac(0.6),
    conditions: z
      .strictObject({
        pain: condition(50, 0.1, 0),
        fever: condition(40, 0.15, 0.3),
        bleeding: condition(30, 0.2, 0.2),
      })
      .prefault({}),
  })
  .prefault({});

export type WoundPenalties = z.infer<typeof WoundPenaltiesSchema>;
export type BodyGroup = z.infer<typeof BodyGroupSchema>;
