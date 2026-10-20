import { z } from 'zod';

/** Domyślna szansa (0–1) zachorowania po zjedzeniu zepsutego jedzenia. */
export const DEFAULT_FOOD_SPOILED_SICKNESS_CHANCE = 0.25;
/** Domyślne punkty zatrucia z zepsutego jedzenia (ta sama skala co zatrucie wodą). */
export const DEFAULT_FOOD_SPOILED_POISON_LOAD = 15;

export const FoodSpoiledSicknessChanceSchema = z.number().min(0).max(1);
export const FoodSpoiledPoisonLoadSchema = z.number().min(0);
