import { z } from 'zod';
import { CapacityKgSchema, ExtSchema } from './common/index.js';
import { CharacterCreationSchema } from './character-creation.js';
import { CraftingSettingsSchema } from './crafting-settings.js';
import { LootSettingsSchema } from './loot-rarity.js';
import { FirearmsSettingsSchema } from './firearms-settings.js';
import { OpeningsSettingsSchema } from './openings-settings.js';
import { NoiseSettingsSchema } from './noise-settings.js';
import { AiSettingsSchema } from './ai-settings.js';
import { VisionSettingsSchema } from './vision-settings.js';
import { MovementSettingsSchema } from './movement-settings.js';
import { SimLodSettingsSchema } from './sim-lod-settings.js';
import { MapMarkersSettingsSchema, PlayerMapSettingsSchema } from './map-markers-settings.js';
import { SurvivalSettingsSchema } from './survival/index.js';
import { VehiclesSettingsSchema } from './vehicles-settings.js';
import { UtilitiesSettingsSchema } from './utilities-settings.js';
import {
  FurnitureFootprintSchema,
  FurnitureLongSideAccessSchema,
  FurnitureTallSchema,
} from './furniture-settings.js';
import { LightingSettingsSchema } from './lighting-settings.js';

/**
 * Ustawienia świata — pojedynczy obiekt z `world-settings.json` w korzeniu paczki i opcjonalnych
 * fragmentów `world-settings/*.json` (np. po kategorii przetrwania). Wszystkie pliki paczek łączy
 * głęboki merge w kolejności wczytywania; każde pole ma wartość domyślną.
 */
export const WorldSettingsSchema = z.strictObject({
  /** Długość doby gry w minutach rzeczywistych. */
  dayLengthMinutes: z
    .number()
    .positive()
    .max(24 * 60)
    .default(60),
  /** Tworzenie postaci: pula punktów, koszt umiejętności, imię, wygląd startowy. */
  characterCreation: CharacterCreationSchema,
  carry: z
    .strictObject({
      /** Bazowy limit udźwigu postaci (stat `carry-capacity-kg` modyfikują cechy i siła). */
      baseCapacityKg: CapacityKgSchema.default(12),
      /** Mnożnik tempa zmęczenia przy przeciążeniu (spowolnienie ruchu liczy fizyka w sim, moodle `heavy-load` jest tylko wskaźnikiem). */
      overloadFatigueMul: z.number().min(1).max(10).default(1.5),
      /** Twardy limit jako wielokrotność udźwigu — powyżej nie da się podnieść przedmiotu. */
      hardLimitMultiplier: z.number().min(1).max(10).default(2),
    })
    .default({ baseCapacityKg: 12, overloadFatigueMul: 1.5, hardLimitMultiplier: 2 }),
  /** Stałe przetrwania dla Symulacji (Etap 2). */
  survival: SurvivalSettingsSchema,
  /** Skalowanie rzadkości lootu (sandbox). */
  loot: LootSettingsSchema,
  /** Crafting i łączenie: skąd brać składniki. */
  crafting: CraftingSettingsSchema,
  /** Zasięg widzenia w dzień i w nocy, bonus światła. */
  vision: VisionSettingsSchema,
  /** Chód / bieg / skradanie gracza (m/s i mnożniki). */
  movement: MovementSettingsSchema,
  /** Znaczniki na mapie gracza (ikony, kolory, limity). */
  mapMarkers: MapMarkersSettingsSchema,
  /** Mapa gracza: odkrywanie chunków i ślad drogi. */
  playerMap: PlayerMapSettingsSchema,
  /** Hałas między piętrami: tłumienie przez strop. */
  noise: NoiseSettingsSchema,
  /** Zombie: gubienie tropu (czas bez wzroku i słuchu, dystans). */
  ai: AiSettingsSchema,
  /** Drzwi i okna: wytrzymałość, hałas, przechodzenie przez okno. */
  openings: OpeningsSettingsSchema,
  /** Broń palna: spadek celności z odległością, rozrzut, ładowanie magazynków. */
  firearms: FirearmsSettingsSchema,
  /** LOD symulacji dużej mapy: obszar aktywny, komórki zgrubne zombie, leniwy łup. */
  simLod: SimLodSettingsSchema,
  /** Pojazdy: wsiadanie, zamki i kluczyki, bagażnik / schowek, klakson, kable (Symulacja). */
  vehicles: VehiclesSettingsSchema,
  /** Prąd i woda z sieci: wyłączenie po losowej liczbie dni (Symulacja). */
  utilities: UtilitiesSettingsSchema,
  /** Meble zajmują kafle swojego footprintu (Symulacja; domyślnie wyłączone). */
  furnitureFootprint: FurnitureFootprintSchema,
  /** Meble zasłaniające wzrok przy `furnitureFootprint`. */
  furnitureTall: FurnitureTallSchema,
  /** Meble obsługiwane tylko wzdłuż dłuższej krawędzi przy `furnitureFootprint` (lada). */
  furnitureLongSideAccess: FurnitureLongSideAccessSchema,
  /** Włączniki światła, zasłony, światło w oknie wabiące zombie (Symulacja). */
  lighting: LightingSettingsSchema,
  ext: ExtSchema,
});

export type WorldSettings = z.infer<typeof WorldSettingsSchema>;
