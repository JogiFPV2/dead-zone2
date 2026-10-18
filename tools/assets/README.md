# @deadzone/assets

Offline pipeline assetów: źródłowe GLB (+ tekstury) → zoptymalizowane GLB + manifest z licencjami.

```sh
pnpm --filter @deadzone/assets assets build   # pobiera packi (cache: tools/assets/.cache), buduje, aktualizuje ASSETS.md
pnpm --filter @deadzone/assets assets check   # licencje + obecność plików z manifestu
```

- Definicje packów: `packs/<id>.json` (licencja SPDX, URL źródła, URL zipa + sha256, lista modeli).
  Zamiast zipa: pojedyncze pliki z `url` (np. Poly Pizza) albo z `path` (plik w repo, np.
  `animals/*.glb`, skonwertowane raz offline z FBX/.blend: `assets animal-sources <katalog>` z env
  `FBX2GLTF` i `BLENDER`). `keepAnimations` zostawia w animowanych modelach tylko wymienione klipy.
  Pack bez wpisu licencji albo z licencją spoza `CC0-1.0` jest odrzucany.
- Kroki (gltf-transform + meshoptimizer, bez natywnych binarek): paleta → dedup → weld →
  (simplify dla LOD) → kwantyzacja + `EXT_meshopt_compression` → prune.
- Paleta: packi low-poly (Kenney, Quaternius) mają jedną teksturę-paletę. Tekstura jest usuwana z
  GLB i zapisywana raz na pack (`palette.ktx2`, UASTC przez WASM `ktx2-encoder`, działa na CI);
  wszystkie modele dostają materiał `<pack>/palette`, który w grze jest jednym współdzielonym
  materiałem (`apps/game/src/assets/materials.ts`). `encoding: "png"` wyłącza KTX2.
- LOD: osobne pliki `<model>.lodN.glb`; poziom, który nie zmniejsza liczby trójkątów o ≥ 15%, jest
  pomijany (low-poly ze szwami UV często już nie da się uprościć).
- Wyjście: `apps/game/public/models/` (`manifest.json`). Build jest deterministyczny.
- Ikony przedmiotów: `assets icons [rozmiar]` renderuje `icons/items.json` (modele w `icons/src/`)
  rigiem Designera `icons/rig.html` w headless Chrome (SwiftShader) do `apps/game/public/icons/`
  (+ `index.json`). Narzędzie offline: potrzebuje Chrome i playwright-core (`PLAYWRIGHT_CORE`,
  `CHROME`); PNG są w repo, CI ich nie renderuje.
- Runtime: `apps/game/src/assets/loader.ts`; strona testowa (tylko dev): `?assettest=1`
  (`&budgetmb=N` pokazuje ostrzeżenie budżetu GPU).

## Materiał modelu: `vc` albo `pbr`

Pilot stylu realistycznego (`render.style = 'real'` w kliencie). Wpis modelu w packu może mieć
`material` i `pbr` (`src/material.ts`):

```json
{
  "id": "blok-p4",
  "material": "pbr",
  "pbr": {
    "albedo": "textures/pbr/deadzone-pbr-albedo-1024.ktx2",
    "normal": "textures/pbr/deadzone-pbr-normal-1024.ktx2",
    "orm": "textures/pbr/deadzone-pbr-orm-1024.ktx2",
    "layers": "textures/pbr/layers.json",
    "lowRes": {
      "albedo": "textures/pbr/deadzone-pbr-albedo-512.ktx2",
      "normal": "textures/pbr/deadzone-pbr-normal-512.ktx2",
      "orm": "textures/pbr/deadzone-pbr-orm-512.ktx2"
    }
  }
}
```

- `material: 'vc' | 'pbr'`, domyślnie `vc` (kolory wierzchołków / paleta packu, dzisiejszy wygląd).
  Stare dane bez pola zostają bez zmian, a `manifest.json` nie dostaje żadnego pola.
- `pbr: { albedo, normal, orm, layers, lowRes?: { albedo, normal, orm } }`: tablice tekstur
  warstw (`orm` = occlusion, roughness, metalness) i opis warstw. Ścieżki względne do
  `apps/game/public` (bez `/` na początku, bez `..`). Tekstury `.ktx2`, `.png` albo `.webp`,
  `layers` to `.json`. `lowRes` jest opcjonalne, ale jeśli jest, to ma wszystkie trzy tekstury.
  `pbr` jest wymagane przy `material: 'pbr'` i odrzucane przy `vc`.
- Numer warstwy nie siedzi w danych, tylko w GLB (`TEXCOORD_1` każdego wierzchołka).
- `layers.json` (`PbrLayersFileSchema`): `{ version: 1, material, layers: [{ index, id, name,
source, url | null, tileMeters, tint: 'natural' | 'tint', meanLinear: [r, g, b],
meanRoughness }] }`. `layers[i].index` musi być równe `i`, a `id` muszą być unikalne. Dodatkowe
  pola są dozwolone.
- `scale?: number` na wpisie modelu (z `material` albo bez niego): jednolita skala do metrów,
  którą klient stosuje przy stawianiu modelu (GLB nie jest przeskalowywany). Musi być dodatnia i
  skończona, domyślnie 1, np. sedan Kenneya `{ "id": "sedan", "scale": 1.69 }`. To samo pole co
  `scale` w `models/deadzone-pbr/index.json` (#230). Do manifestu trafia tylko, gdy ≠ 1.
- Model `pbr` trafia do manifestu z `material: "pbr"` i `pbr`; `assets check` sprawdza, czy
  wszystkie pliki istnieją i czy `layers.json` pasuje do schematu. Schemat `MaterialFieldsSchema` można dołożyć do innych wpisów (np. zestaw
  miasta `deadzone-town`).
