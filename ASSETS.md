# Assety

Każdy asset w repo musi być tu wpisany z licencją (docs/PLAN.md). Na start tylko CC0.
Pipeline (`tools/assets`) odmawia budowania packa bez wpisu licencji lub z licencją spoza CC0.

## Ikony przedmiotów (`apps/game/public/icons/`)

Renderowane z modeli 3D stałym rigiem Designera (`tools/assets/icons/rig.html`: kamera ortho 30°/35°,
3 światła + hemisphere, 2 px obrys): `pnpm --filter @deadzone/assets assets icons [rozmiar=128]`.
Modele źródłowe w `tools/assets/icons/src/`, lista w `tools/assets/icons/items.json`. Modele w
`icons/src/custom/` to przeróbki Designera (Blender, skrypty i licencje w `/workspace/assets-src/custom/`,
kopia `LICENSE.txt` obok modeli). Magazynki nie mają jeszcze modelu (ikona wektorowa).

Te same modele źródłowe są bronią w dłoni / na plecach postaci w grze (`apps/game/src/weapons/weapon-models.ts`,
import przez Vite z `tools/assets/icons/`, bez kopii); broń bez modelu w `items.json` dostaje prosty placeholder.

| Ikona (przedmioty)                   | Model                      | Autor / źródło                                                                              | Licencja |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| kitchen-knife                        | `cooking-knife.glb`        | Kenney, Food Kit (kenney.nl/assets/food-kit)                                                | CC0-1.0  |
| canned-beans                         | `can.glb`                  | Kenney, Food Kit                                                                            | CC0-1.0  |
| hammer                               | `tool-hammer.glb`          | Kenney, Survival Kit (kenney.nl/assets/survival-kit)                                        | CC0-1.0  |
| pistol, compact-pistol, heavy-pistol | Pistol                     | Quaternius, poly.pizza/m/J3i9KDQ3kt                                                         | CC0-1.0  |
| water-bottle, dirty-water-bottle     | Water Bottle               | Quaternius, poly.pizza/m/KpxDpidn1Z                                                         | CC0-1.0  |
| bandage, sterilized-bandage          | `custom/bandaz.glb`        | FacadeGaikan, „Medical Stuff” › Gauze, opengameart.org/content/medical-stuff (przemalowany) | CC0-1.0  |
| duct-tape                            | `custom/tasma-klejaca.glb` | darkrose, „Duct Tape”, opengameart.org/content/duct-tape (przemalowana)                     | CC0-1.0  |
| nails                                | `custom/gwozdzie.glb`      | model własny Deadzone (Blender, `build_items.py`)                                           | CC0-1.0  |
| revolver, magnum-revolver            | Revolver                   | Quaternius, poly.pizza/m/E7IaG9TptR                                                         | CC0-1.0  |
| pump-shotgun                         | Shotgun                    | CreativeTrio, poly.pizza/m/CkSFaW2d7m                                                       | CC0-1.0  |
| double-barrel-shotgun                | `custom/dwururka.glb`      | z „Shotgun Sawed Off”, Quaternius, poly.pizza/m/29FXKu7G91 (dłuższe lufy, własna kolba)     | CC0-1.0  |
| hunting-rifle                        | Sniper                     | CreativeTrio, poly.pizza/m/lpvx546Djt                                                       | CC0-1.0  |
| assault-rifle                        | Assault Rifle              | Quaternius, poly.pizza/m/Bgvuu4CUMV                                                         | CC0-1.0  |
| ammo-9mm/-45/-38/-44 + pudełka       | `custom/amunicja-9mm.glb`  | z „Pistol Ammo”, CreativeTrio, poly.pizza/m/Kh2hNjWMXA (pudełko na żółto)                   | CC0-1.0  |
| shotgun-shell, ammo-box-shells       | Ammo Shotgun               | CreativeTrio, poly.pizza/m/btpe2U9ODn                                                       | CC0-1.0  |
| ammo-308/-556 + pudełka              | `custom/amunicja-308.glb`  | z „Ammo Sniper”, CreativeTrio, poly.pizza/m/3OsqMhlfd7 (pudełko na zielono)                 | CC0-1.0  |
| nailed-bat                           | Wooden Bat Barbed          | Quaternius, poly.pizza/m/HSM4KnggSz                                                         | CC0-1.0  |
| baseball-bat                         | Baseball Bat               | Pichuliru, poly.pizza/m/POXTjdMP2c                                                          | CC0-1.0  |
| crowbar                              | Crowbar                    | Pichuliru, poly.pizza/m/OS8gAoeDtM                                                          | CC0-1.0  |

## Dźwięki (`apps/game/public/audio/`)

Każdy plik jest w dwóch formatach: `.ogg` (Vorbis) i `.mp3` (fallback dla Safari). Przekodowane ffmpeg
z oryginałów; sumy SHA-256 dotyczą pobranych oryginałów.

| Plik                                                                          | Oryginał                                                                | Autor / źródło                                                                                                                | Licencja | SHA-256 oryginału                                                                                   |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `menu-emptycity` (muzyka menu, 1:40)                                          | `EmptyCity.ogg`                                                         | yd, „EmptyCity: Background Music”, opengameart.org/content/emptycity-background-music                                         | CC0-1.0  | 10cdeb8e7ede29f8afeedaec23f16297752a89aac36c37b06a0262b5190efaad                                    |
| `amb-crickets` (otoczenie, pętla)                                             | `crickets_1.mp3`                                                        | Wolfgang\_ (nagranie: Ted Kerr), „Crickets Ambient Noise - loopable”, opengameart.org/content/crickets-ambient-noise-loopable | CC0-1.0  | 5b5bd1f744087888c5623543c3ff80be9c2ce106093993e7c8a8492b0280b2c0                                    |
| `ui-click1`, `ui-rollover2`, `ui-switch2`                                     | `click1.ogg`, `rollover2.ogg`, `switch2.ogg` z paczki                   | Kenney, „UI Audio”, kenney.nl/assets/ui-audio (`License.txt` w paczce: CC0)                                                   | CC0-1.0  | paczka `kenney_ui-audio.zip`: 946fc23a63d535d693eb31b2eabb80c8c28d6351e2186b344ceb71b2cb1d5eb6      |
| `sfx-step-concrete0..3`, `sfx-step-wood0..3` (kroki: na zewnątrz / w budynku) | `footstep_concrete_000..003.ogg`, `footstep_wood_000..003.ogg` z paczki | Kenney, „Impact Sounds”, kenney.nl/assets/impact-sounds (`License.txt` w paczce: CC0)                                         | CC0-1.0  | paczka `kenney_impact-sounds.zip`: 029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8 |
| `sfx-hit0..2` (trafienie wręcz, pchnięcie, atak zombie)                       | `impactPunch_medium_000..002.ogg` z paczki                              | Kenney, „Impact Sounds”, kenney.nl/assets/impact-sounds (CC0)                                                                 | CC0-1.0  | jak wyżej                                                                                           |
| `sfx-door-open`, `sfx-door-close`                                             | `doorOpen_1.ogg`, `doorClose_1.ogg` z paczki                            | Kenney, „RPG Audio”, kenney.nl/assets/rpg-audio (`License.txt` w paczce: CC0)                                                 | CC0-1.0  | paczka `kenney_rpg-audio.zip`: 6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b     |

## Pack testowy pipeline'u (nieużywany w scenie gry)

<!-- assets-pipeline:begin -->
<!-- Generowane przez `pnpm --filter @deadzone/assets assets build`; nie edytuj ręcznie. -->

| Pack                                         | Autor                                       | Licencja                                                      | Źródło                                 | W repo                                                      |
| -------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| Furniture Kit                                | Kenney (www.kenney.nl)                      | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://kenney.nl/assets/furniture-kit | 10 modeli (`apps/game/public/models/kenney-furniture/`)     |
| Survival Kit                                 | Kenney (www.kenney.nl)                      | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://kenney.nl/assets/survival-kit  | 11 modeli (`apps/game/public/models/kenney-survival/`)      |
| Animated characters (Casual, Worker, Hoodie) | Quaternius (quaternius.com), via Poly Pizza | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://poly.pizza/u/Quaternius        | 3 modeli (`apps/game/public/models/quaternius-characters/`) |

<!-- assets-pipeline:end -->
