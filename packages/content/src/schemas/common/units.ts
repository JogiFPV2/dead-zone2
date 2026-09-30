import { z } from 'zod';

/**
 * Jednostki (kontrakt z Symulacją): waga w kg, czas w minutach gry, odległość w kaflach
 * (1 kafel = 1 m), statystyki 0–100, temperatura w °C. Jednostka w nazwie pola, gdy niejasna.
 */

/** Waga w kg. */
export const WeightKgSchema = z.number().min(0).max(1000);
/** Pojemność w kg. */
export const CapacityKgSchema = z.number().min(0).max(10000);
/** Ułamek 0..1 (szanse, redukcje). */
export const FractionSchema = z.number().min(0).max(1);
/** Poziom umiejętności 0..10. */
export const SkillLevelSchema = z.number().int().min(0).max(10);
/** Odległość w kaflach (1 kafel = 1 m). */
export const TilesSchema = z.number().min(0).max(500);
/** Zmiana statystyki w skali 0–100 (może być ujemna). */
export const StatDeltaSchema = z.number().min(-100).max(100);
/** Temperatura w °C. */
export const CelsiusSchema = z.number().min(-60).max(80);
