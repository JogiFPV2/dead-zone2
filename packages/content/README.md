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
  node/       wczytywanie paczek z dysku i CLI (`@deadzone/content/node`)
  test/       testy Vitest
data/base/    paczka bazowa
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
  `lootTables`, `zombieTypes`, `containers`, `tiles` oraz `worldSettings`). Mapy są w wyniku walidacji
  (`validatePacks(…).maps`), nie w bundlu.

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

Dopisz obiekt w `data/base/recipes/`: `ingredients` (item albo tag), `tools` (zwykle tag, np. `base:tool-hammer`),
`skills`, `durationMin`, `results`, `xp`. Receptura z `requiresLearning: true` musi być gdzieś odblokowana
(książka `unlocksRecipes`, zawód lub cecha `knownRecipes`).

## Paczka moda

```
my-mod/
  mod.json              { "id": "my-mod", "name": "…", "version": "1.0.0", "dependencies": [{ "id": "base" }] }
  world-settings.json   opcjonalnie, głęboki merge z ustawieniami bazy
  world-settings/       opcjonalne fragmenty ustawień (np. survival-needs.json), merge po world-settings.json
  items/ recipes/ skills/ traits/ professions/ moodles/ loot-tables/ zombie-types/ containers/ tiles/
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

## Loot

Wpis tabeli ma całkowitą `weight` i `rarity` (`common` | `uncommon` | `rare` | `very_rare`);
`worldSettings.loot.rarityWeightPct` skaluje wagi według rzadkości. Tabela pasuje do schowka, gdy jego
pomieszczenie jest w `rooms`, a typ w `containers` (pusta lista = każdy schowek). Pudełka amunicji to rodzaj
`ammo_box` (`ammoBox: { ammo, count }`).

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
- `edges`: rzadka lista `{ x, y, side: "n" | "w", type: "wall" | "window" | "door", contentId }`. Krawędź
  południowa/wschodnia to `n`/`w` sąsiedniego kafla (na granicy — w sąsiednim chunku). `contentId` wskazuje
  `tiles/` z `category` równym `type`.
- `objects`: `{ contentId, x, y, rot: 0–3 (co 90°), offset? }`, `contentId` to typ schowka albo przedmiot
  `placeable`. Światłem jest obiekt z blokiem `placeable.light`.
- Stanu dynamicznego (otwarte, rozbite, zabite deskami, zawartość schowków) nie ma w plikach chunków.
