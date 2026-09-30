# Fonty HUD (self-hosted)

Zmienne pliki woff2 (oś `wght`) z [Fontsource](https://fontsource.org) 5.3.0 (npm `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`), podzbiory `latin` i `latin-ext` (polskie znaki).

| Plik                                            | Font               | Licencja                             |
| ----------------------------------------------- | ------------------ | ------------------------------------ |
| `inter-latin{,-ext}-wght-normal.woff2`          | Inter (rsms/inter) | SIL OFL 1.1, `OFL-Inter.txt`         |
| `jetbrains-mono-latin{,-ext}-wght-normal.woff2` | JetBrains Mono     | SIL OFL 1.1, `OFL-JetBrainsMono.txt` |

`@font-face` jest w `src/styles/fonts.css`. Build kopiuje ten katalog do `dist/fonts/`, obok `dist/*.css`.
