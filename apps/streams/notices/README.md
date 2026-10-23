# Bundled fonts

DM Sans and Manrope Latin variable normal WOFF2 subsets are redistributed unchanged
from `@fontsource-variable/dm-sans@5.3.0` and `@fontsource-variable/manrope@5.3.0`
(the `files/*-latin-wght-normal.woff2` files in their published npm archives).
Both are licensed under SIL Open Font License 1.1, which permits redistribution
with the accompanying copyright and license notices:

- DM Sans: [copyright and OFL](DM-Sans-OFL.txt), upstream https://github.com/googlefonts/dm-fonts
- Manrope: [copyright and OFL](Manrope-OFL.txt), upstream https://github.com/sharanda/manrope

These assets are bundled by Vite with content hashes and cached by the app's
same-origin static-assets service worker. Other scripts use the system fallback.
