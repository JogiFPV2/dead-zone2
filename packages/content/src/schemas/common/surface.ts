import { z } from 'zod';

/**
 * Wysokość blatu mebla w metrach (od podłogi), na którym stoi mebel z `onSurface` (telewizor na
 * szafce RTV 0.55, lampka na biurku 0.75). Zgodna z modelem ±0.05 m (test furniture-fit).
 */
export const SurfaceHeightMSchema = z.number().positive().max(3);
