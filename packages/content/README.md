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
`worldSettings.loot.rarityWeightPct` skaluje wagi według rzadkości. Tabela pasuje do schowka, gdy jego
pomieszczenie jest w `rooms`, a typ w `containers` (pusta lista = każdy schowek). Pudełka amunicji to rodzaj
`ammo_box` (`ammoBox: { ammo, count }`).

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
  `placeable`. Światłem jest obiekt z blokiem `placeable.light`.
- `zones` (opcjonalne, w manifeście): `{ id, role, z, rects: [{ x, y, w, h }], tags? }`. `id` i `role` w kebab-case,
  `id` unikalne w mapie, rola może się powtarzać. Prostokąty w globalnych kaflach (`x = cx * 32 + lx`), sumowane;
  punkt = 1×1. Granice piętra `z` to prostokąt obejmujący chunki manifestu na tym piętrze. Błędy: `zone_duplicate_id`,
  `zone_empty`, `zone_out_of_bounds`.
- Stanu dynamicznego (otwarte, rozbite, zabite deskami, zawartość schowków) nie ma w plikach chunków.
