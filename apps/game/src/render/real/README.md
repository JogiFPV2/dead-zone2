# Styl realistyczny (PBR) — pilot

Flaga `render.style = 'real'`, testowo `?style=real&quality=low|medium|high` (domyślnie
`medium`). Bez flagi gra wygląda i działa jak dotąd: nic z tego katalogu się nie ładuje
(`default-off.test.ts`).

- **Dane wyłącznie z manifestu** (`models/manifest.json`, schemat Modules: `material: 'pbr'`,
  `pbr: { albedo, normal, orm, layers, lowRes? }`, `scale?`). Pliki dostarcza Designer
  (`assets build`); ten katalog ich nie zawiera. Brak danych `pbr` w manifeście = styl real się
  nie włącza (domyślny wygląd).
- **Tekstury**: trzy tablice KTX2 po 13 warstw (albedo sRGB, normal w trybie Basis normal:
  X = RGB, Y = A, ORM). low = `lowRes` (512), medium / high = zestaw główny (1024). Warstwy,
  kafel w metrach i średnie albedo: `layers.json`. Zasady: `docs/STYLE.md`.
- **Materiał** `deadzone-pbr` (`pbr-shader.ts`, port `dz-html/style/pbr/pbr-material.js`):
  `sampler2DArray`, TBN z pochodnych, brud, makrowariacja, wydeptana trawa. Trzy warianty:
  - `model` — `*.pbr.glb` Designera (`pbrUv` / `pbrL` po `preparePbrGeometry`, `COLOR_0` = tint);
  - `kit` — moduły miasta bez zmian geometrii: warstwa z komórki palety (`kit-layers.ts`), UV z
    rzutu pudełkowego w metrach świata, kolor palety podniesiony do zakresu STYLE.md (`KIT_LIFT`);
  - `terrain` — teren: warstwa z `dmask` (asfalt, trawa, płyty, ziemia), UV = świat XZ.
- **Modele**: zasoby manifestu z `material: 'pbr'` (meshopt, pozycje kwantyzowane — skala
  dekwantyzacji siedzi w węźle i jest zachowana; `scale` zasobu mnożony na wierzch, brak →
  1, a dla `sedan` awaryjnie 1,69). Id = nazwa pliku bez `.glb`. Drzewa kitu
  (`prop-tree*`) zastępuje `drzewo-lisciaste` (w tych samych BatchedMesh). Bloki, domy, śmietnik,
  sedan i krzak: na razie tylko w podglądzie `?pbrdemo=x,z` (InstancedMesh, 1 draw call na plik),
  bo mapa nie ma jeszcze dla nich miejsc.
- **Presety** (`quality.ts`, tabela STYLE.md §5): tekstury, cienie PCF (1024 / 2048 / 4096,
  normalBias 0,09), GTAO (brak / ½ rozdz. 8 próbek / pełna 16), RoomEnvironment 0,12 na high,
  limit pixel ratio, budżet draw calli (low < 250). `withOverrides()` przyjmuje nowe wartości.
- **Pomiar**: `window.__dzReal.budget()` = draw calle ostatniej klatki (z cieniami i postem).
