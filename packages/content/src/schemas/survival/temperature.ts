import { z } from 'zod';
import { celsius, num } from './num.js';

/**
 * Temperatura ciała (°C). Poza przedziałem komfortu otoczenia ciało stygnie lub grzeje się
 * proporcjonalnie do różnicy, a izolacja ubrań (`clothing.insulation`) mnoży stygnięcie przez (1 − izolacja).
 */
export const TemperatureSettingsSchema = z
  .strictObject({
    bodyBaseC: celsius(37),
    comfortMinC: celsius(18),
    comfortMaxC: celsius(25),
    /** °C ciała na minutę gry za każdy °C otoczenia poniżej `comfortMinC`. */
    coolingPerDegPerMin: num(0.0015, 1),
    /** °C ciała na minutę gry za każdy °C otoczenia powyżej `comfortMaxC`. */
    heatingPerDegPerMin: num(0.0012, 1),
    /** Grzanie wysiłkiem (bieg, sprint, walka), °C na minutę gry. */
    exertionHeatingPerMin: num(0.006, 1),
    /** Powrót do `bodyBaseC` w komforcie, °C na minutę gry. */
    recoveryPerMin: num(0.01, 1),
    hypothermiaBelowC: celsius(32.5),
    hyperthermiaAboveC: celsius(40.5),
    /** Utrata zdrowia na minutę gry poza tymi granicami. */
    healthLossPerMin: num(0.05, 100),
  })
  .prefault({});

/** Przemoczenie (stat `wetness` 0–100). Deszcz przyjdzie z pogodą; tempa są gotowe wcześniej. */
export const WetnessSettingsSchema = z
  .strictObject({
    /** W deszczu, mnożone przez (1 − `clothing.waterResistance`). */
    rainGainPerMin: num(2, 100),
    /** Wejście do wody (brodzenie) — natychmiast do tej wartości. */
    wadingWetness: num(60, 100),
    dryIndoorsPerMin: num(0.35, 100),
    dryOutdoorsPerMin: num(0.2, 100),
    dryNearHeatPerMin: num(1.2, 100),
    /** Przy 100 przemoczenia otoczenie „odczuwa się” o tyle °C chłodniej (liniowo). */
    feelsColderAtMaxC: num(6, 40),
  })
  .prefault({});

export type TemperatureSettings = z.infer<typeof TemperatureSettingsSchema>;
export type WetnessSettings = z.infer<typeof WetnessSettingsSchema>;
