# @deadzone/content

Schematy contentu (zod v4), walidator paczek, `ContentBundle` dla Symulacji i paczka bazowa gry.

## Układ

```
src/
  schemas/    schematy zod, jeden mały plik na schemat
    common/   id, jednostki, klucze i18n, modyfikatory, warunki
    item/     unia rozróżniana po `kind`, jeden plik na rodzaj
    recipe/ trait/ …  receptury, cechy, zawody, moodle, loot, zombie, schowki, świat, manifest
  validate/   walidator (czysty TS, bez API Node) i sprawdzanie referencji (checks/)
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
  `lootTables`, `zombieTypes`, `containers` oraz `worldSettings`).

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
  items/ recipes/ skills/ traits/ professions/ moodles/ loot-tables/ zombie-types/ containers/
  overrides/            zmiany cudzych definicji
```

Id moda jest namespace wszystkich jego definicji (`my-mod:…`). Plik zawiera jedną definicję albo tablicę.
Definicje innych paczek zmienia się w `overrides/`: `{ "op": "merge" | "replace" | "remove", "type": "item",
"target": "base:axe", "data": { … } }`. Nadpisanie celu, którego nie ma, jest błędem. Kolejność wczytywania
wynika z `dependencies`, `loadAfter`, `loadBefore` i `priority`.
