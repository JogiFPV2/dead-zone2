# Assety

Każdy asset w repo musi być tu wpisany z licencją (docs/PLAN.md). Na start tylko CC0.
Pipeline (`tools/assets`) odmawia budowania packa bez wpisu licencji lub z licencją spoza CC0.

## Ikony przedmiotów (`apps/game/public/icons/`)

Renderowane z modeli 3D stałym rigiem Designera (`tools/assets/icons/rig.html`: kamera ortho 30°/35°,
3 światła + hemisphere, 2 px obrys): `pnpm --filter @deadzone/assets assets icons [rozmiar=128]`.
Modele źródłowe w `tools/assets/icons/src/`, lista w `tools/assets/icons/items.json`. Taśma i gwoździe
zostają wektorowe (`@deadzone/ui`), bandaż używa ikony apteczki.

| Ikona (przedmioty)                     | Model               | Autor / źródło                                       | Licencja |
| -------------------------------------- | ------------------- | ---------------------------------------------------- | -------- |
| kitchen-knife                          | `cooking-knife.glb` | Kenney, Food Kit (kenney.nl/assets/food-kit)         | CC0-1.0  |
| canned-beans                           | `can.glb`           | Kenney, Food Kit                                     | CC0-1.0  |
| hammer                                 | `tool-hammer.glb`   | Kenney, Survival Kit (kenney.nl/assets/survival-kit) | CC0-1.0  |
| pistol                                 | Pistol              | Quaternius, poly.pizza/m/J3i9KDQ3kt                  | CC0-1.0  |
| water-bottle, dirty-water-bottle       | Water Bottle        | Quaternius, poly.pizza/m/KpxDpidn1Z                  | CC0-1.0  |
| bandage, sterilized-bandage (apteczka) | First Aid Kit       | Quaternius, poly.pizza/m/Hp80p6148W                  | CC0-1.0  |
| nailed-bat                             | Wooden Bat Barbed   | Quaternius, poly.pizza/m/HSM4KnggSz                  | CC0-1.0  |
| baseball-bat                           | Baseball Bat        | Pichuliru, poly.pizza/m/POXTjdMP2c                   | CC0-1.0  |
| crowbar                                | Crowbar             | Pichuliru, poly.pizza/m/OS8gAoeDtM                   | CC0-1.0  |

## Pack testowy pipeline'u (nieużywany w scenie gry)

<!-- assets-pipeline:begin -->
<!-- Generowane przez `pnpm --filter @deadzone/assets assets build`; nie edytuj ręcznie. -->

| Pack                                         | Autor                                       | Licencja                                                      | Źródło                                 | W repo                                                      |
| -------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| Furniture Kit                                | Kenney (www.kenney.nl)                      | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://kenney.nl/assets/furniture-kit | 10 modeli (`apps/game/public/models/kenney-furniture/`)     |
| Survival Kit                                 | Kenney (www.kenney.nl)                      | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://kenney.nl/assets/survival-kit  | 11 modeli (`apps/game/public/models/kenney-survival/`)      |
| Animated characters (Casual, Worker, Hoodie) | Quaternius (quaternius.com), via Poly Pizza | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://poly.pizza/u/Quaternius        | 3 modeli (`apps/game/public/models/quaternius-characters/`) |

<!-- assets-pipeline:end -->
