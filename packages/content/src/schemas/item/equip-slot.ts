import { z } from 'zod';

/** Sloty, w których można nosić przedmiot. */
export const EquipSlotSchema = z.enum([
  'hand_primary',
  'hand_secondary',
  'back',
  'belt',
  'head',
  'face',
  'torso_inner',
  'torso_outer',
  'hands',
  'legs',
  'feet',
]);

export type EquipSlot = z.infer<typeof EquipSlotSchema>;
