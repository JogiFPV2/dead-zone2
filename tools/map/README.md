# @deadzone/map — narzędzie do budowania map

Buduje mapy w chunkach (format z `@deadzone/content`: `maps/<id>/manifest.json` i `chunks/<cx>_<cy>_<z>.json`) z krótkiego blueprintu JSON i waliduje istniejące mapy. Format map i schematy zod są w `@deadzone/content`; to narzędzie ich nie definiuje od nowa.

## Użycie

```sh
# zbuduj mapę do paczki (domyślnie packages/content/data/base), z pełną walidacją paczki
pnpm --filter @deadzone/map map build tools/map/blueprints/demo-house.json [--pack <katalog>]
# sprawdź, czy pliki w paczce są aktualne względem blueprintu (nic nie zapisuje)
pnpm --filter @deadzone/map map build <blueprint.json> --check
# tylko schematy map, bez referencji do contentu (np. placeholdery spoza paczki)
pnpm --filter @deadzone/map map build <blueprint.json> --pack <katalog> --schema-only
# waliduj paczki i wypisz ich mapy (domyślnie paczka base)
pnpm --filter @deadzone/map map validate [<katalog-paczki>…]
```

`build` najpierw waliduje wynik razem z paczką docelową (i z base, jeśli paczka docelowa nią nie jest), a zapisuje dopiero bez błędów. Usuwa też nieaktualne pliki chunków tej mapy. Wynik jest deterministyczny i sformatowany Prettierem.

## Blueprint

Schemat jest w `src/blueprint.ts`. Wszystkie współrzędne to kafle świata (+x na wschód, +y na południe). Późniejsze wpisy nadpisują wcześniejsze.

- `id`, `name?`, `floorHeight` (domyślnie 3), `chunks: {cx0, cy0, cx1, cy1}` (poziom 0),
- `ground`: podłoga wszędzie,
- `areas`: prostokąty podłogi `{x, y, w, h, floor}` (drogi, parcele, ścieżki),
- `buildings`: `{id (buildingId), origin, plan, rooms, wall, window?, door?, roof?, openings}`:
  - `plan`: rzut ASCII, jeden string na wiersz; znak to klucz w `rooms` (`{id: roomId, type, floor}`), `.` i spacja to zewnątrz;
  - ściany powstają same na każdej granicy pokój | inny pokój oraz pokój | zewnątrz;
  - `openings`: `{at: [x, y] (lokalnie w planie), side: n|s|e|w, type: door|window, contentId?}` zamienia wygenerowaną ścianę w drzwi albo okno; krawędzie `s`/`e` zapisuje jako `n`/`w` sąsiada, także w sąsiednim chunku,
  - dach pokrywa wszystkie kafle pokojów,
- `objects`: `{contentId, x, y, rot?, offset?}`.

Paleta chunka ma kolejność z blueprintu (ground, areas, podłogi pokojów, dach) i zawiera tylko użyte id (1-based, 0 = pusto). Warstwy są kodowane automatycznie (krótszy zapis: RLE albo base64).

## Blueprinty

- `blueprints/demo-house.json`: odtwarza `base:demo-house` (testy sprawdzają, że warstwy, krawędzie, pokoje i obiekty są równe). Pliki w paczce przygotował Modules i mają inny układ JSON, więc `build` bez `--check` przepisałby ich formatowanie. Zanim blueprint stanie się źródłem, trzeba to uzgodnić.
- `blueprints/test-town.json`: odtwarza wygenerowaną mapę testową gry (`apps/game/src/world/test-map.ts`) kafel w kafel (test round trip w grze). Używa placeholderów (`base:asphalt`, `base:roof-flat`, `base:wall-plain`, `base:window-plain`, `base:door-plain`, pokoje `living-room` i `bedroom`), których content jeszcze nie definiuje. Dlatego waliduje się tylko z `--schema-only` i nie ma jej w paczce base.
