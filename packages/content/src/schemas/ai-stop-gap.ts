import { z } from 'zod';

/** Domyślny odstęp (m), na którym zombie zatrzymuje się przed celem (od krawędzi ciał). */
export const DEFAULT_AI_STOP_GAP_M = 0.15;

/** `worldSettings.ai.stopGapM` (≥ 0); schemat nie wstawia domyślnej. */
export const AiStopGapSchema = z.number().min(0);
