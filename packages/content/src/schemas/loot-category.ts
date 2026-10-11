import { z } from 'zod';

/**
 * Kategoria przedmiotu dla lootu schowków („co realnie leży w tym meblu”). Domyślnie wyliczana
 * z `kind` i tagów przedmiotu (`lootCategoryOf`), przedmiot może ją ustawić jawnie
 * (`lootCategory`). Schowek deklaruje dozwolone kategorie w `lootAccepts`.
 */
export const LOOT_CATEGORIES = [
  /** Psujące się jedzenie: warzywa, mięso, ryby, resztki gotowanych dań. */
  'food-fresh',
  /** Trwałe jedzenie: konserwy, słoiki, suche produkty. */
  'food-canned',
  'drink',
  /** Garnki, patelnie, wałek. */
  'cookware',
  /** Drobiazgi domowe: zapałki, zapalniczka, reklamówki, igła i nici. */
  'household',
  /** Tkaniny: prześcieradła, szmaty, ręczniki. */
  'fabric',
  'clothing',
  /** Torby i plecaki. */
  'bag',
  'medical',
  /** Książki i czasopisma. */
  'literature',
  'vhs',
  /** Baterie, radio, latarki, elektronika. */
  'electronics',
  /** Narzędzia (też te, którymi da się bić: młotek, łom, klucz). */
  'tool',
  /** Materiały: deski, gwoździe, taśma, drut, złom, cegły. */
  'material',
  /** Sprzęt sportowy: kij bejsbolowy, kij golfowy. */
  'sport',
  /** Broń biała (noże, maczety, włócznie). */
  'weapon',
  'firearm',
  /** Amunicja, pudełka nabojów, magazynki. */
  'ammo',
  /** Części i paliwo do aut, kluczyki. */
  'vehicle',
  /** Meble i urządzenia (placeable). */
  'furniture',
  /** Śmieci: potłuczone szkło, puste butelki. */
  'junk',
  'misc',
] as const;

export const LootCategorySchema = z.enum(LOOT_CATEGORIES);
export type LootCategory = z.infer<typeof LootCategorySchema>;
