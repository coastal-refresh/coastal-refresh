# Self-hosted fonts

These fonts are served from this site (declared in `css/styles.css`) so that
visitors' browsers don't contact Google Fonts.

| Font | Used for | Files | License |
| --- | --- | --- | --- |
| Fraunces | Headings | `fraunces-*-wght-normal.woff2` (variable, weight 600–700), `fraunces-*-600-italic.woff2` | SIL Open Font License 1.1 — `LICENSE-Fraunces.txt` |
| Inter | Body text | `inter-*-wght-normal.woff2` (variable, weight 400–700) | SIL Open Font License 1.1 — `LICENSE-Inter.txt` |

The font software is unmodified; the OFL requires these license notices to
stay with the files, so please keep them here.

## Where the files came from

Packaged by [Fontsource](https://fontsource.org) from the official Google
Fonts releases:

- `@fontsource-variable/fraunces` 5.3.0 — upright variable files
- `@fontsource/fraunces` 5.3.0 — static 600 italic files
- `@fontsource-variable/inter` 5.3.0 — variable files

When these were added, they were compared with the files `fonts.googleapis.com`
served for the site's previous stylesheet request: the upright Fraunces and
Inter files and the 600 italic are the same size/axes (the italic is
byte-identical), so typography is unchanged.

Only the `latin` and `latin-ext` subsets are included (English plus accented
European names). Greek, Cyrillic and Vietnamese text typed into the contact
form would fall back to the system font; add the matching Fontsource subset
files and `@font-face` rules if that ever matters.
