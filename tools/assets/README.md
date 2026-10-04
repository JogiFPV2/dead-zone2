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
