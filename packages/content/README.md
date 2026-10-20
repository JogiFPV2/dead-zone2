# @deadzone/content

Schematy contentu (zod v4), walidator paczek, `ContentBundle` dla Symulacji i paczka bazowa gry.

## Układ

```
src/
  schemas/    schematy zod, jeden mały plik na schemat
    common/   id, jednostki, klucze i18n, modyfikatory, warunki
    item/     unia rozróżniana po `kind`, jeden plik na rodzaj
    recipe/ trait/ …  receptury, cechy, zawody, moodle, loot, zombie, schowki, świat, manifest
    map/      manifest i chunk mapy, kodeki warstw (RLE, base64)
  validate/   walidator (czysty TS, bez API Node), referencje (checks/) i mapy (maps/)
  bundle/     ContentBundle i buildContentBundle(packs)
  places/     schemat miejsc, `nearestPlace`, rejestr plików per mapa (`@deadzone/content/places`)
  footprint/  rozmiar mebli w kaflach i zajmowane kafle (`@deadzone/content/footprint`)
  node/       wczytywanie paczek z dysku, `loadPlaces` i CLI (`@deadzone/content/node`)
  test/       testy Vitest
data/base/    paczka bazowa
places/       nazwy miejsc map (JSON `{ name, x, y }`), np. stalowa-wola.json
```

Główne wejście (`@deadzone/content`) nie używa API Node, więc działa w przeglądarce i w `packages/sim`.

## Kontrakt

- Id: `namespace:nazwa` w kebab-case, np. `base:canned-beans`.
- Jednostki: waga w kg (`weightKg`), czas w minutach gry (`durationMin`), odległość w kaflach, 1 kafel = 1 m
  (`rangeTiles`), statystyki 0–100, temperatura w °C. Tempo walki (`attacksPerSec`, `reloadSec`) w sekundach rzeczywistych.
- Modyfikatory cech i zawodów to dane: `{ stat, op: 'add' | 'mul', value, when? }`, gdzie `when` to obiekt,
  np. `{ "moodle": "base:panic", "minLevel": 2 }` albo `{ "skill": "base:carpentry", "minLevel": 3 }`.
- `buildContentBundle(packs)` waliduje, łączy mody w kolejności wczytywania i zwraca głęboko zamrożony
  `ContentBundle` (Recordy po id: `items`, `recipes`, `skills`, `traits`, `professions`, `moodles`,
  `lootTables`, `zombieTypes`, `containers`, `tiles`, `gameModes`, `stations`, `appearanceParts`, `palettes` oraz `worldSettings`). Mapy są w wyniku walidacji
  (`validatePacks(…).maps`), nie w bundlu.
- Zombie (`zombieTypes`): opcjonalne `attackReachM` (m, >0, ≤1.5, odstęp od krawędzi ciał; domyślnie
  `DEFAULT_ZOMBIE_ATTACK_REACH_M` = 0.3) i `windupMs` (`{ min, max }`, całkowite ms, min ≤ max; domyślnie
  `DEFAULT_ZOMBIE_WINDUP_MS` = 500–800). Brak pola = sim bierze wartość domyślną.
- Leki: opcjonalne `medicine` przy każdym przedmiocie: `{ reduceSickness, durationMin }` (punkty choroby 0–100,
  minuty gry >0; domyślnie `DEFAULT_MEDICINE_REDUCE_SICKNESS` = 30 i `DEFAULT_MEDICINE_DURATION_MIN` = 60).
- Zepsute jedzenie: w `food` opcjonalne `spoiledSicknessChance` (0–1, domyślnie `DEFAULT_FOOD_SPOILED_SICKNESS_CHANCE` = 0.25)
  i `spoiledPoisonLoad` (≥0, skala jak zatrucie wodą, domyślnie `DEFAULT_FOOD_SPOILED_POISON_LOAD` = 15). Schemat nie wstawia domyślnych.

## Miejsca

Pliki `places/<plik>.json` to tablice `{ name, x, y, kind? }` (x, y w kaflach, układ mapy świata; `kind`:
`district` | `town` | `village`, opcjonalne). Mapa → plik: `PLACES_FILES` (`osm-stw` → `stalowa-wola.json`).

```ts
// lekkie wejście (tylko zod, bez DOM, bez tools/map): przeglądarka, sim, serwer
import { placesFileSchema, nearestPlace, placesFileFor } from '@deadzone/content/places';
// Node (serwer): odczyt + walidacja + zamrożenie; null, gdy mapa nie ma pliku albo pliku jeszcze nie ma
import { loadPlaces, createPlacesCache } from '@deadzone/content/node';

const places = await loadPlaces(character.world_settings.map); // readonly Place[] | null
const place = nearestPlace(places, x, y); // string | null
```

Surowy JSON jest też pod `@deadzone/content/places/stalowa-wola.json`. Nowa mapa z nazwami: plik w `places/`
i wpis w `src/places/places-files.ts`; test sprawdza, że każdy plik z rejestru przechodzi schemat.

## Punkty zaczepienia przewodów

Obok każdego modelu słupa leży `<modelId>.attach.json` (np. `apps/game/public/models/<zestaw>/pole-hv110.glb` +
`pole-hv110.attach.json`). Silnik rysuje przewód ze zwisem między punktami o tym samym `id` na kolejnych słupach.

```json
{ "modelId": "pole-hv110", "kind": "hv110", "attach": [{ "id": "L1", "x": -3.5, "y": 18, "z": 0 }] }
```

- `x`, `y`, `z` w metrach względem podstawy słupa; y w górę (> 0), słup stoi wzdłuż osi x (w poprzek linii).
- `kind` → dozwolone `id` (`WIRE_RULES`): `hv110`/`hv220`/`hv400`: `L1`–`L3` wymagane; opcjonalnie komplet
  drugiego toru `L4`–`L6` (wszystkie trzy albo żaden), opcjonalny `GW` (odgromowy) oraz `GW2` tylko razem z `GW`;
  `lv`: `N` + opcjonalnie komplet `L1`–`L3`; `catenary`: `CW` (jezdny) i `MW` (lina nośna). Id bez powtórzeń.
- Test `wire-attach-files.test.ts` waliduje każdy `*.attach.json` w `apps/game/public/models`, `packages`
  i `tools/assets`: schemat, `modelId` = nazwa pliku i model `.glb`/`.gltf` obok.

```ts
// lekkie wejście (tylko zod, bez DOM i Three.js)
import { attachFileSchema, attachPoint, type AttachFile } from '@deadzone/content/wires';

const file = attachFileSchema.parse(json);
const l1 = attachPoint(file, 'L1'); // AttachPoint | undefined
```

## Improwizowana broń

Każdy przedmiot w ręku jest bronią (jak w Project Zomboid). Przedmiot, który nie jest bronią białą, może mieć
opcjonalny blok `improvisedWeapon` (`src/schemas/item/improvised-weapon.ts`): `damage {min,max}`, `rangeTiles`,
`attackSpeed` (ataki/s, jak `attacksPerSec`), `durability` (punkty), `breakChancePct` (0–100, szansa utraty punktu
trwałości przy trafieniu), opcjonalnie `skill`, `damageType` (`blunt` | `sharp`), `twoHanded`, `staminaCost`.

```ts
import { meleeStatsFor, type MeleeStatsView } from '@deadzone/content';

const s = meleeStatsFor(item);
// { damage: {min,max}, rangeTiles, attackSpeed, durability, breakChancePct, skill,
//   twoHanded, damageType, staminaCost, critChance, source: 'weapon' | 'improvised' | 'default' }
```

Kolejność: `melee` broni z katalogu → blok `improvisedWeapon` → słabe wartości domyślne z wagi
(`defaultMeleeStats(weightKg)`, `IMPROVISED_DEFAULTS`; też broń palna jako pałka). Bez bloku `skill` to
`base:blunt` (tępa) albo `base:blade-short` (ostra).

## Walidacja

```sh
pnpm --filter @deadzone/content validate data/base [ścieżka/do/moda …]
```

Błędy mają plik i ścieżkę JSON, np. `data/base/recipes/basic.json $[1].tools[0].tag [missing_tag] …`.

## Jak dodać przedmiot

1. Wybierz plik w `data/base/items/` (albo dodaj nowy, najwyżej ~120 linii).
2. Dopisz obiekt z `id`, `name` (klucz i18n, np. `item.base.axe.name`), `kind`, `weightKg` i blokiem rodzaju
   (`melee`, `ranged`, `food`, `bag`, …). Pola opisuje plik w `src/schemas/item/`.
3. Uruchom `validate` i testy.

## Jak dodać recepturę

Dopisz obiekt w `data/base/recipes/<grupa>.json` (survival, medical, carpentry, weapons, cooking, tailoring,
metal-electrical): `ingredients` (item albo tag), `tools` (zwykle tag, np. `base:tool-hammer`), `skills`,
`durationMin` (minuty gry), `results`, `xp` (umiejętność i ilość). `category` to grupa w oknie warsztatu: `weapons`,
`tools`, `food`, `medical`, `building`, `furniture`, `electronics`, `clothing`, `materials`, `stations`. Narzędzia
(`tools`, niezużywane) są zawsze osobno od składników (`ingredients`, zużywane). Stan receptury w UI wynika z danych:
dostępna, brak części (`ingredients`/`tools`), brak umiejętności (`skills`), za niski poziom stacji (`station.minLevel`).
Składniki bierze się z ekwipunku i schowków w promieniu `worldSettings.crafting.nearbyRadiusTiles` (3). Receptura z `requiresLearning: true` musi być gdzieś odblokowana (książka
`unlocksRecipes`, zawód lub cecha `knownRecipes`), inaczej walidator zgłasza `unlearnable_recipe`.

- `kind`: `craft` (domyślnie) albo `combine`, czyli łączenie w ekwipunku. `combine` ma najwyżej 4 części (wpisy
  `ingredients`; ilość w wpisie dowolna, np. gwoździe ×5), może wymagać narzędzi z ekwipunku (młotek), nie ma stacji
  (błędy `combine_too_many_parts`, `combine_has_station`).
- `station: { id, minLevel }`: stacja z `stations/` (`base:station-workbench`, `base:station-mechanic`, `base:station-fire`,
  `base:station-electronics`) na poziomie co najmniej `minLevel` (1–3).
- `repair: { item | tag, restorePct }`: naprawa (taśma na broń, nici na ubranie) przywraca `restorePct` %
  trwałości celu, który nie jest zużywany; wtedy `results` może być puste.

## Stacje

`stations/`: `{ id, name, category, levels: [{ level, item, recipe, craftTimeMultiplier }] }`, poziomy 1..3 po kolei. Przedmiot poziomu jest
`placeable` z `placeable.station = { id, level }` (można go postawić, znaleźć albo umieścić na mapie jako obiekt).
Receptura poziomu 1 go buduje, a od poziomu 2 ulepsza, czyli zużywa przedmiot poprzedniego poziomu. Błędy: `station_level_gap`,
`station_item_mismatch`, `station_upgrade_missing`, `station_level_missing` (receptura wymaga poziomu, którego stacja nie ma). Dolny pasek warsztatu: ulepszenie na
poziom N to `levels[N].recipe`, bonus to `craftTimeMultiplier` (base: 1 / 0.8 / 0.65), a „odblokowuje” to receptury
z `station.minLevel = N`.

## Postać, książki

- Zawody (`professions/`): `points` (ujemne = mocny zawód zabiera punkty), `skillBonuses`, `freeTraits`,
  `knownRecipes`, `startingItems`, `modifiers`. Darmowe cechy zawodu nie mogą się wykluczać.
- Cechy (`traits/<kategoria>.json`): `cost` > 0 pozytywna, < 0 negatywna, `conflicts` (wystarczy po jednej
  stronie), `modifiers`, `skillBonuses`, `xpMultipliers`. Cechy dynamiczne mają `gainedWhen`/`lostWhen`
  (`{ stat, op, value, sustainedMin }`, np. `body-weight-kg`, `zombies-killed`); `selectable: false` = tylko z zawodu albo z gry.
- Książki umiejętności: serie po 5 tomów (`items/books-<umiejętność>.json`, tom N dla poziomów 2N−2..2N−1),
  magazyny z recepturami w `items/recipe-magazines.json`; loot w tabelach `base:skill-books` i `base:recipe-magazines`
  (księgarnia `base:room-bookstore`, dom, szkoła).
- Kasety VHS (`kind: 'vhs'`, `items/vhs-*.json`): `vhs { skills: 1–3 × { skill, xp }, watchSec (30 s rzeczywistych),
oncePerCharacter (true), tvTag ('base:station-tv') }`. Telewizor to `placeable` z tagiem `tvTag` i
  `placeable.power { consumesW }`; generator ma `placeable.powerSource { outputW, radiusTiles, fuelTag, litersPerFuelItem,
tankLiters, litersPerHour, noise }` (paliwo: `base:gas-can` z tagiem `base:fuel`). Błędy `vhs_no_tv`,
  `vhs_duplicate_skill`. Loot: tabela `base:vhs-tapes` w salonie, sypialni i księgarni, wypożyczalnia `base:video-rental`
  (`base:room-video-store`).

## Zbiornik wody (`placeable.waterTank`)

Mebel może mieć zbiornik wody: `waterTank: { capacityL, quality, refillFromMains }` (`schemas/item/water-tank.ts`,
typ `WaterTank`). `capacityL` > 0 to skończony zapas w litrach, `quality` to `clean` (pitna) albo `tainted` (brudna,
do zagotowania), `refillFromMains` (domyślnie `true`) = dopełnia się, dopóki działa woda w sieci; po odcięciu
zostaje tylko zapas. Przykład: toaleta `base:toilet` = `{ capacityL: 10, quality: 'tainted', refillFromMains: true }`.
Pobór i gotowanie wody liczy symulacja.

Butelka to przedmiot z `waterContainer: { capacityL }` (dowolny `kind`, `schemas/item/water-container.ts`, typ
`WaterContainer`; base: `base:bottle`, `base:water-bottle`, `base:dirty-water-bottle` po 0,5 l). Picie i napełnianie
ustawia `worldSettings.water` (`world-settings/water.json`, `schemas/water-settings.ts`, typ `WaterSettings`):
`tankDrinkL` (0,25 l na łyk `drink-tank`; pragnienie jak `hygiene.drinkTap.thirst`), `fillMin` (0,5 min gry na
`fill-water`), `bottles { empty, clean, tainted }` (pusta butelka i to, czym staje się po napełnieniu czystą / brudną
wodą). Porcja napełniania = `capacityL / drink.uses` przedmiotu wynikowego. Walidator: butelki muszą istnieć (`missing_ref`), a
`clean` i `tainted` mieć `waterContainer` (`water_bottle_no_container`).

Zatrucie brudną wodą: `worldSettings.water.poisoning` (`schemas/water-poisoning.ts`, typ `WaterPoisoning`; Symulacja,
docs 9.60). Pola (base = domyślne): `taintedChance` 0.4 (szansa na łyk brudnej wody ze zbiornika, gdy butelka nie ma
`drink.perUse.sicknessChance`), `dose` 35 (zatrucie z jednego trafienia), `risePerHour` 20 i `recoverPerHour` 4 (narastanie
i ustępowanie), `nauseaFrom` 20 i `unhappinessPerHour` 4 (mdłości → przygnębienie), `healthLossFrom` 70,
`healthLossPerMin` 0.02 i `minHealth` 10 (utrata zdrowia, nie poniżej progu). Gotowanie (`base:boil-water`) oczyszcza wodę.

## Tworzenie postaci

- Palety (`palettes/`): `{ id, name, kind: skin | hair | cloth, colors: [{ id, hex }] }` (base: `base:skin` 8, `base:hair` 10,
  `base:cloth` 16).
- Części wyglądu (`appearance-parts/`): `{ id, name, slot: head | top | bottom | shoes, modelRef, tints:
[{ channel: primary | secondary, palette }], bodyTypes }`. `modelRef` to klucz assetu Silnika (`char/head-short`);
  każdy slot musi mieć co najmniej 1 opcję. `head` to gotowy wariant (twarz i fryzura w jednym modelu Quaternius), jego
  kanał `primary` to kolor włosów, a skórę barwi `skin`. Lista slotów jest rozszerzalna (później osobne `face`, `hair`,
  `beard`).
- `worldSettings.characterCreation`: `startPoints` (8), `maxSkillLevelAtStart` (3), `skillPointCost` ([1, 2, 3], koszt
  poziomu N), `name { minLen, maxLen }`, `skinPalette`, `defaultAppearance`. Wygląd w stanie postaci:
  `{ skin: colorId, parts: { <slot>: { part, colors: { primary?, secondary? } } } }` (`AppearanceSchema`).
- Pula punktów = `startPoints` + `profession.points` − Σ `trait.cost` − koszt umiejętności. Zawód z ujemnymi punktami
  zabiera je z puli, cecha z dodatnim kosztem kosztuje, z ujemnym daje punkty; pula nie może zejść poniżej 0.
- Błędy: `palette_duplicate_color`, `appearance_palette_kind` (głowa → hair, ubrania → cloth),
  `appearance_slot_empty`, `creation_cost_invalid`, `creation_default_invalid` (plus `missing_ref` dla palet).

## Paczka moda

```
my-mod/
  mod.json              { "id": "my-mod", "name": "…", "version": "1.0.0", "dependencies": [{ "id": "base" }] }
  world-settings.json   opcjonalnie, głęboki merge z ustawieniami bazy
  world-settings/       opcjonalne fragmenty ustawień (np. survival-needs.json), merge po world-settings.json
  items/ recipes/ skills/ traits/ professions/ moodles/ loot-tables/ zombie-types/ containers/ tiles/
  game-modes/ stations/ appearance-parts/ palettes/
  maps/<mapId>/         manifest.json i chunks/<cx>_<cy>_<z>.json
  overrides/            zmiany cudzych definicji
```

Id moda jest namespace wszystkich jego definicji (`my-mod:…`). Plik zawiera jedną definicję albo tablicę.
Definicje innych paczek zmienia się w `overrides/`: `{ "op": "merge" | "replace" | "remove", "type": "item",
"target": "base:axe", "data": { … } }`. Nadpisanie celu, którego nie ma, jest błędem. Kolejność wczytywania
wynika z `dependencies`, `loadAfter`, `loadBefore` i `priority`.

## Przetrwanie (`worldSettings.survival`)

Stałe przetrwania dla Symulacji leżą w `data/base/world-settings/survival-*.json` (potrzeby i aktywność,
otoczenie, psychika i sen, zdrowie, rany i infekcja); schemat w `src/schemas/survival/`. Każde pole ma
wartość domyślną, więc mod może zmienić jedno pole, np. `{ "survival": { "needs": { "thirstPerMin": 0.05 } } }`.

- Tempa to punkty statystyki (0–100) na minutę gry. Przy `dayLengthMinutes = 60` minuta gry = 2,5 s = 50 ticków.
- `needs` to tempo w bezruchu; `activity.<idle|walking|sneaking|running|sprinting|fighting|sleeping>` je mnoży
  (także spalanie kalorii) i podaje zmianę wytrzymałości na minutę.
- Progi moodli głodu i pragnienia są dobrane tak, że bezczynna postać jest głodna po ~1 dobie gry,
  a spragniona po ~pół doby (test `survival-tuning.test.ts`).
- `woundPenalties`: `severity` (rodzaj rany → `light`/`heavy`), `bodyGroups` (część ciała z `BODY_PARTS` → `head`,
  `torso`, `arm`, `leg`), tabele `light`/`heavy` × grupa z `{ moveSpeed, attackPower, actionSpeed, visionRange }` jako
  ułamek utraty, `bandagedFactor`, `maxPenalty` oraz `conditions.<pain|fever|bleeding> { from, visionRange, blur }`.

Poza przetrwaniem: `vision { enabled, dayRangeTiles, nightFactor, lightBonus }` (gracz i zombie),
`noise { floorMul, maxFloors }` (`world-settings/noise.json`: hałas słychać na innych piętrach, zasięg × `floorMul`
za każde piętro różnicy, najwyżej `maxFloors` pięter),
`carry.overloadFatigueMul` oraz czasy akcji w przedmiotach: `food.eatMin` (porcja, 1), `drink.drinkMin` (łyk, 0.5),
`ammoBox.unpackMin` (0.5). Narzędzie może świecić w ręce: `tool` z `light { radiusTiles, coneDeg, batteryTag,
batteryLifeMin }` (`base:flashlight`, `base:camping-lantern`).

## Loot

Wpis tabeli ma całkowitą `weight` i `rarity` (`common` | `uncommon` | `rare` | `very_rare`);
`worldSettings.loot.rarityWeightPct` skaluje wagi według rzadkości. Pudełka amunicji to rodzaj
`ammo_box` (`ammoBox: { ammo, count }`).

Loot schowka: pojemnik jest ważniejszy niż pomieszczenie (`lootTableForContainer` w `src/loot/`):

1. tabela pomieszczenia, która wprost wymienia typ schowka w `containers` (pomieszczenie podmienia loot, np.
   lodówka w sklepie → `base:shop-fridge`),
2. własna tabela schowka `defaultLootTable` (każdy schowek paczki bazowej poza stawianymi przez gracza ją ma),
3. ogólna tabela pomieszczenia (`containers` puste) — tylko dla schowków bez własnej tabeli; służy też za
   loot leżący na podłodze.

Kategorie: `lootCategoryOf(item)` daje `LootCategory` (`food-fresh`, `food-canned`, `drink`, `cookware`,
`household`, `fabric`, `clothing`, `bag`, `medical`, `literature`, `vhs`, `electronics`, `tool`, `material`,
`sport`, `weapon`, `firearm`, `ammo`, `vehicle`, `furniture`, `junk`, `misc`) z rodzaju i tagów; przedmiot może
ją ustawić jawnie polem `lootCategory`. Schowek deklaruje `lootAccepts` (lodówka: `food-fresh`, `drink`).
Test `container-loot.test.ts` nie przepuści tabeli, która wkłada do schowka coś spoza `lootAccepts`; wyjątki
tylko w `src/test/container-loot-allowlist.ts` z powodem (np. nóż kuchenny w szufladzie kuchennej).
Druga oś to pomieszczenie: `worldSettings.loot.roomAccepts` (`world-settings/loot-rooms.json`, kuchnia →
jedzenie i przybory kuchenne, garaż → narzędzia, łazienka → leki i bandaże), a `placeIn` schowka mówi, w jakich
pomieszczeniach zwykle stoi. Test sprawdza każdą parę schowek × pomieszczenie i loot na podłodze; wyjątki
(`at`: schowek albo `base:room-*`) z powodem.
`lootAccepts` dotyczy tylko lootu — gracz może włożyć do schowka cokolwiek.
Mebel z kilkoma schowkami: `compartments` (lodówka z zamrażarką `base:fridge-freezer` = część lodówkowa +
`["base:freezer"]`); mapa stawia jeden obiekt, każda przegroda ma własną tabelę, `lootAccepts` i psucie.
Piekarnik elektryczny `base:oven` ma `requiresPower`, kuchenka gazowa `base:gas-stove` nie.
Kuchenka z piekarnikiem `base:range` (kuchnia gazowo-elektryczna): palniki gazowe i szuflada bez prądu, przegroda
`base:oven` (piekarnik elektryczny, `requiresPower`). Mapa stawia przedmiot `base:range` (ten sam id): `containerType`
daje schowki, `station` (`base:station-fire` 3) gotowanie. Meble stałe bez schowka (`items/furniture-fixtures.json`):
wanna `base:bathtub`, prysznic `base:shower`, magnetowid `base:vcr` (tag `base:station-vcr`, prąd) i radioodbiornik
`base:radio-set` (tag `base:station-radio`, prąd; przenośne `base:radio` zostaje zwykłym przedmiotem). Zlew kuchenny
`base:kitchen-sink` i umywalka `base:bathroom-sink` to schowki (szafka pod spodem, tabela `base:under-sink`).
Klucze do budynku: `buildingKey` (szansa) w tabeli — sim dokłada przedmiot z tagiem `base:building-key`
przypisany do budynku schowka (w tabeli zwłok: do budynku zombie). Przedmiot klucza: `base:building-key` (bez `buildingId`
w danych — sim nadaje go przy spawnie). Wytrychy: `base:lockpick` i `base:lockpick-fork` (tag `base:lockpick`), rękawice
`base:gloves` (slot `hands`, tag `base:gloves`). Drzwi zewnętrzne są na starcie zamknięte z szansą
`openings.locks.exteriorLockedChance` (0,4; jedno ustawienie dla wszystkich budynków). Lodówka i zamrażarka mają
`requiresPower` i `spoilageMultiplier` (0.3 i 0.05): chłodzą tylko z prądem, bez prądu jedzenie psuje się ×1.

| Schowek                           | Tabela                                                    | Zawartość                                        |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| `base:fridge`                     | `base:kitchen-fridge` (sklep, stacja: `base:shop-fridge`) | świeże jedzenie, resztki dań, napoje             |
| `base:freezer`                    | `base:freezer` (sklep: `base:shop-freezer`)               | mięso, ryby, wódka                               |
| `base:kitchen-cabinet`            | `base:kitchen`                                            | konserwy, słoiki, ziemniaki, woda                |
| `base:kitchen-counter`            | `base:kitchen-drawer`                                     | noże, wałek, zapałki, szmaty, reklamówki, garnek |
| `base:oven`                       | `base:oven`                                               | garnek, patelnia albo pusto                      |
| `base:wardrobe`                   | `base:wardrobe`                                           | ubrania, prześcieradła, torby i plecaki          |
| `base:dresser`                    | `base:bedroom`                                            | ubrania, igła i nici, baterie, książki, kasety   |
| `base:bookshelf`                  | `base:bookshelf`                                          | książki, czasopisma, kasety VHS                  |
| `base:desk`                       | `base:desk`                                               | czasopisma, książki, baterie, zapałki            |
| `base:tv-stand`                   | `base:living-room`                                        | kasety VHS, baterie, radio, latarka              |
| `base:bathroom-cabinet`           | `base:bathroom`                                           | bandaże, szmaty                                  |
| `base:bathroom-sink`              | `base:under-sink`                                         | szmaty, worki na śmieci, reklamówki              |
| `base:kitchen-sink`               | `base:under-sink`                                         | szmaty, worki na śmieci, reklamówki              |
| `base:range`                      | `base:gas-stove` + przegroda `base:oven`                  | patelnia, garnek albo pusto                      |
| `base:tool-chest`                 | `base:toolbox`                                            | narzędzia, gwoździe, taśma, drut                 |
| `base:trash-bin`, `base:dumpster` | `base:trash`                                              | butelki, worki, złom                             |

## Tryby gry i wabiki

- Tryb (`game-modes/`, schemat `src/schemas/game-mode/`): `objective` (`win?`, `lose[]`) z warunków
  `surviveDays`, `extractNpc { npcId, targetZone }`, `npcDead`, `playerDead`, `timeLimitDays`, `all`/`any`;
  `world` (`start`, `zombies`: `populationMultiplier`, `maxActive`, `hordes` wokół stref, `respawn`); `npcs`;
  `map?` i `requiredZones` (role stref, które mapa musi mieć); strefy wskazuje się jako `{ role }`
  (rola z `requiredZones`) albo `{ zone: id }` (wymaga `map`). Błędy: `mode_map_missing`, `mode_zone_role_missing`,
  `mode_zone_id_missing`; `player` (zawody, cechy, punkty, `startingKit`); `score`
  (suma `weight × metric`). Base: `base:survival`, `base:rescue`.
- Wabik to rodzaj `lure`: `noise`, `durationSec` (sekundy rzeczywiste), `trigger` (`remote` z tagiem pilota i zasięgiem
  albo `timer` z przedziałem opóźnienia), `lingerSec`, `power` (tag baterii), `runner` (bieg w kierunku od gracza),
  `consumedOnUse`.

## Mapy

Mapa to `maps/<mapId>/manifest.json` i `maps/<mapId>/chunks/<cx>_<cy>_<z>.json` (np. `-1_0_0.json`); id mapy
to `<namespace>:<mapId>`. Przykład: `data/base/maps/demo-house` (jeden chunk, dom z kuchnią). Pliki map są generowane z blueprintów
narzędziem `tools/map` (`pnpm --filter @deadzone/map map build tools/map/blueprints/demo-house.json`); nie edytuj ich ręcznie.

- Manifest: `formatVersion` (1), `chunkSize` (zawsze 32), `floorHeight` w jednostkach świata (1 kafel = 1 j.),
  `chunks: [{ cx, cy, z }]` — dokładnie te pliki, które są w `chunks/`.
- Chunk: `address`, `palette`, `layers`, `edges`, `objects`, `rooms`. Warstwy to 1024 wartości uint16
  (indeks `y * 32 + x`), w JSON `{ "rle": [[wartość, ile], …] }` albo `{ "base64": "…" }` (Uint16 little-endian).
  Kodeki: `encodeRle`/`decodeRle`, `encodeBase64U16`/`decodeBase64U16`, `encodeLayer`/`decodeLayer`.
- `floor`, `roof`: wartość `v` to `palette[v - 1]`, 0 = pusto; paleta jest lokalna dla chunka i wskazuje `tiles/`.
- `room`: wartość to `roomId` z `rooms` (0 = na zewnątrz); `rooms: { "1": { roomType, buildingId } }`.
  `roomType` (np. `base:room-kitchen`) musi być w `rooms` jakiejś loot table. `roomId` i `buildingId` są wspólne dla mapy.
- `edges`: rzadka lista `{ x, y, side: "n" | "w", type: "wall" | "window" | "door" | "fence", contentId }`. Krawędź
  południowa/wschodnia to `n`/`w` sąsiedniego kafla (na granicy — w sąsiednim chunku). `contentId` wskazuje
  `tiles/` z `category` równym `type`. `fence` to niski płot (blokuje ruch, nie wzrok; base: `base:wooden-fence`).
- `stairs` (opcjonalne, brak = bez schodów): biegi schodów z piętra chunka `z` na `z + 1`,
  `{ tx, ty, dir: "N" | "E" | "S" | "W", len: 1–16 }`. (`tx`, `ty`) to najniższy kafel (lokalnie w chunku), `dir` to
  kierunek wchodzenia, bieg ma `len` kafli i może wejść do sąsiedniego chunka. Wejście od dołu (krawędź pierwszego
  kafla po stronie przeciwnej do `dir`) albo z góry (kafel (tx, ty) + len × dir na `z + 1`). Pierwszy kafel stoi na
  podłodze, biegi w chunku nie zachodzą na siebie. Kształt jest ten sam co `SimChunk.stairs` w `@deadzone/protocol`. Mapy bez schodów są
  poprawne bez zmian (`formatVersion` zostaje 1, bo pole jest opcjonalne).
- `objects`: `{ contentId, x, y, rot: 0–3 (co 90°), offset? }`, `contentId` to typ schowka albo przedmiot
  `placeable`. Światłem jest obiekt z blokiem `placeable.light`. Mebel większy niż 1×1 zajmuje kafle wg
  „Footprint mebli” (niżej); `x`, `y` to wtedy jego północno-zachodni kafel.
- `zones` (opcjonalne, w manifeście): `{ id, role, z, rects: [{ x, y, w, h }], tags? }`. `id` i `role` w kebab-case,
  `id` unikalne w mapie, rola może się powtarzać. Prostokąty w globalnych kaflach (`x = cx * 32 + lx`), sumowane;
  punkt = 1×1. Granice piętra `z` to prostokąt obejmujący chunki manifestu na tym piętrze. Błędy: `zone_duplicate_id`,
  `zone_empty`, `zone_out_of_bounds`.
- Stanu dynamicznego (otwarte, rozbite, zabite deskami, zawartość schowków) nie ma w plikach chunków.

## Zamki drzwi

Drzwi zewnętrzne budynku (pokój po jednej stronie, dwór po drugiej) są na starcie zamknięte na klucz z szansą zależną od
rodzaju budynku: `openings.locks.exteriorLockedChanceByBuilding` (opcjonalna mapa rodzaj → 0–1). Rodzaj spoza mapy albo
budynek bez rodzaju dostaje `exteriorLockedChance` (domyślna). Brama / furtka w ogrodzeniu to osobny typ krawędzi i ma
klucz `gate`, niezależnie od budynku. `SimChunk.lockedDoors` z generatora ma pierwszeństwo przed losowaniem.

Rodzaj budynku sim wylicza z typów jego pomieszczeń (zebranych po `roomBuildings`):
`buildingKindFromRooms(roomTypes)`, potem `exteriorLockedChanceFor(locks, kind)` (dla bramy: `'gate'`). Tabela
`BUILDING_KIND_ROOMS` (`schemas/building-kind.ts`) jest w kolejności priorytetu — wygrywa pierwszy wiersz, którego
pomieszczenie jest w budynku. Nazwy rodzajów to podzbiór `BUILDING_KINDS` generatora (`tools/map/src/osm/types.ts`).

| Priorytet | Rodzaj                            | Pomieszczenia                                                                            | Szansa                       |
| --------- | --------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------- |
| 1–3       | `hospital`, `school`, `police`    | `base:room-hospital`, `-school`, `-police`                                               | 0,2                          |
| 4–7       | `pharmacy`, `shop`, `fuel`, `gym` | `-pharmacy`; `-shop`, `-video-store`, `-gun-store`, `-bookstore`; `-gas-station`; `-gym` | 0,7                          |
| 8         | `house`                           | `-living-room`, `-kitchen`, `-bedroom`                                                   | 0,4                          |
| 9–10      | `office`, `industrial`            | `-office`; `-warehouse`                                                                  | 0,7                          |
| 11        | `garage`                          | `-garage`                                                                                | 0,5                          |
| 12        | `ruin`                            | `-ruin`                                                                                  | 0                            |
| —         | `gate`                            | brama w ogrodzeniu (krawędź `gate`)                                                      | 0,1                          |
| —         | brak rodzaju                      | np. sama `-hall` (kościół), `-bathroom`                                                  | 0,4 (`exteriorLockedChance`) |

Sklep z mieszkaniami na piętrze to sklep, dom z garażem to dom, szpital z apteką to szpital. Rodzajów generatora, których
nie da się odróżnić po pomieszczeniach, nie ma w mapie: `block` i `kostka` wychodzą jako `house`, `station` jako `shop`,
`fire-station` jako `office`, `shed` jako `garage`, `church` bez rodzaju.

## Footprint mebli

Mebel (typ schowka w `containers/` albo przedmiot `placeable`) może mieć `footprint: { w, h }` w kaflach
(1 kafel = 1 m, liczby całkowite 1–4, `FOOTPRINT_MAX_TILES`). Brak pola = 1×1, więc stare mapy, zapisy i mody
działają bez zmian; zapis gry niczego nie przechowuje. Schowek i przedmiot o tym samym id muszą mieć ten sam rozmiar (test).

- `w` biegnie wzdłuż lokalnej osi +x modelu (szerokość, wzdłuż ściany), `h` wzdłuż lokalnej +z (głębokość, w stronę
  pokoju). Plecy modelu (krany, wezgłowie) są od strony −z.
- `rot` jak w obiektach mapy: indeks 0–3, obrót co 90° zgodnie z ruchem wskazówek zegara patrząc z góry
  (x na wschód, y na południe); klient obraca model o −rot·90° wokół osi pionowej. Plecy do ściany: 0 = północnej
  (−y), 1 = wschodniej (+x), 2 = południowej (+y), 3 = zachodniej (−x).
- Przy `rot` 1 i 3 boki się zamieniają: `rotatedFootprint(rot, fp)` → 2×1 staje się 1×2.
- **Kotwica:** `x`, `y` obiektu to zawsze kafel o najmniejszym x i y (północno-zachodni róg) zajętego prostokąta,
  przy każdym obrocie. Mebel rozciąga się w +x na `W` kafli i w +y na `H` kafli (`W×H` po obrocie). Dla 1×1 to dokładnie
  dotychczasowy kafel. Środek modelu to `footprintCenter` = `(x + W/2, y + H/2)` (dla 1×1 `x + 0.5, y + 0.5`, jak dotąd).

```ts
// lekkie wejście (tylko zod, bez DOM i Three.js); to samo jest w głównym wejściu
import {
  footprintForId,
  footprintOf,
  occupiedTiles,
  footprintCenter,
} from '@deadzone/content/footprint';

const fp = footprintForId(bundle, o.contentId); // albo footprintOf(bundle.containers[id] ?? bundle.items[id])
occupiedTiles(o.x, o.y, o.rot, fp); // wanna 2×1, rot 1, (5, 7) → [{x:5,y:7}, {x:5,y:8}]
```

Rozmiary paczki bazowej (test `footprint-base.test.ts`): 2×1 — wanna `base:bathtub`, lada `base:shop-counter`,
biurko `base:desk`, kanapa `base:sofa`, szeroki regał `base:metal-shelf`; 1×2 — łóżko `base:bed` (pojedyncze, 90×200 cm,
wezgłowie przy ścianie). Reszta 1×1, m.in. wąski regał `base:bookshelf`, lodówki, kuchenki, piekarnik, zlewy,
szafka RTV i prysznic. Łóżka podwójnego (2×2) w paczce jeszcze nie ma.

Blaty: `surfaceHeightM` (m od podłogi, > 0, ≤ 3) na typie schowka albo w `placeable` to wysokość blatu, na którym
można postawić mebel z `placeable.onSurface: true` (stoi na meblu pod spodem, nie na podłodze; nie blokuje kafla).
Base: szafka RTV `base:tv-stand` 0.55, biurko `base:desk` 0.75, stół `base:table` 0.75, lada `base:shop-counter`
0.95; na blatach: `base:tv`, `base:vcr`, `base:radio-set`, `base:desk-lamp`. Odczyt: `surfaceHeightForId(bundle, id)`,
`onSurfaceForId(bundle, id)` (`@deadzone/content/footprint`). Test furniture-fit pilnuje, że blat zgadza się z górą
modelu (`furniture/*.glb`, max y) ±0.05 m.
