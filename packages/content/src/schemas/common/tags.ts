import { z } from 'zod';
import { CONTENT_ID_PATTERN } from './id.js';

/** Tag ma ten sam format co id, np. `base:tool-hammer`, `base:food-canned`. */
export const TagSchema = z
  .string()
  .regex(CONTENT_ID_PATTERN, 'tag musi mieć postać `namespace:kebab-name`');

export const TagListSchema = z.array(TagSchema).default([]);

export type Tag = z.infer<typeof TagSchema>;
