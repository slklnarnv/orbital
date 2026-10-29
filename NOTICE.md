# Third-party notices

The source code of Orbital is MIT-licensed (see [LICENSE](LICENSE)). The
project bundles or streams the following third-party material, each under its
own terms. Provenance details for the model pipeline live in
[`docs/ISS_MODEL_CONTEXT.md`](docs/ISS_MODEL_CONTEXT.md); texture provenance
in [`public/textures/README.md`](public/textures/README.md).

## Data

| Item | Files | Source | Licence |
|---|---|---|---|
| ISS two-line elements (live) | fetched at runtime via `/api/tle` | [CelesTrak](https://celestrak.org/) and [wheretheiss.at](https://wheretheiss.at/) | Public domain (US Government work); CelesTrak asks for polite, identified use — the proxy sends a project User-Agent |
| ISS two-line elements (packaged) | `src/data/fallback-tle.json` | CelesTrak, refreshed by `npm run refresh:tle` | Public domain |
| Place names (countries, oceans, seas) | `src/data/place-index.json`, built by `scripts/build-place-index.mjs` | [Natural Earth](https://www.naturalearthdata.com/) v5.1.2, 1:50m admin-0 countries and marine polygons | Public domain |
| City search (observer for visible passes) | `src/data/city-index.json`, built by `scripts/build-city-index.mjs` | [Natural Earth](https://www.naturalearthdata.com/) v5.1.2, 1:10m populated places | Public domain |
| Live clouds | fetched hourly by `/api/clouds` (`api/clouds.ts`) and converted to a cloud map | NOAA [GMGSI](https://www.ospo.noaa.gov/Products/imagery/gmgsi/) longwave infrared, via the NOAA Open Data Dissemination program on AWS (`noaa-gmgsi-pds`) | Public domain (US Government work) |
| Weather and timezone | fetched at runtime | [Open-Meteo](https://open-meteo.com/) | CC BY 4.0 (data), keyless |
| ISS module facts (launch dates, agencies, masses) | `src/data/issModules.ts` | NASA [Station Assembly Elements](https://www.nasa.gov/international-space-station/international-space-station-assembly-elements/) and the element pages it links, read 2026-10-26; the purpose lines are our own wording | Facts; NASA material, generally not copyrighted |

## 3D models

| Item | Files | Source | Licence |
|---|---|---|---|
| ISS, high fidelity | `public/models/iss_igoal.glb` | NASA "International Space Station (ISS) (D) (IGOAL)" asset, rebuilt by `scripts/build-iss-model.mjs` | NASA material, generally not copyrighted — see the [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/); the NASA insignia and name must not imply endorsement |
| ISS, Locate LOD | `public/models/iss_igoal_locate.glb` | Derived from the high asset by `scripts/build-iss-locate-lod.mjs` | As above |
| ISS, legacy detailed | `public/models/international_space_station.glb` | NASA 3D Resources | As above |
| ISS, schematic fallback | `public/models/International Space Station (ISS) (A).glb` | NASA 3D Resources | As above |
| Draco decoder | `public/draco/*` | [google/draco](https://github.com/google/draco) | Apache-2.0 |
| Basis Universal transcoder | `public/basis/*` | [BinomialLLC/basis_universal](https://github.com/BinomialLLC/basis_universal), via three.js; the `.js` glue is patched to avoid string evaluation by `scripts/patch-basis-transcoder.mjs` | Apache-2.0 |

The ISS assets are rendered at roughly 1,000× their real size so the station
stays legible at orbital scale. That is a deliberate visualization choice, not
a claim about the hardware.

## Imagery

| Item | Files | Source | Licence |
|---|---|---|---|
| Earth day map | `public/textures/earth-day-4k.webp`, `public/textures/earth-day-8k.ktx2` | NASA Blue Marble Next Generation, July 2004, topography and bathymetry ([Visible Earth 73751](https://visibleearth.nasa.gov/images/73751)) | Public domain |
| Earth night lights | `public/textures/earth-night-4k.webp`, `public/textures/earth-night-8k.ktx2` | NASA Black Marble 2016, VIIRS ([Visible Earth 144898](https://visibleearth.nasa.gov/images/144898)) | Public domain |
| Earth clouds | `public/textures/earth-clouds-4k.webp` | NASA cloud composite | Public domain |
| Earth ocean specular | `public/textures/earth-specular-4k.webp` | Derived from the Blue Marble bathymetry/land mask | Public domain |
| Star map | `public/textures/starmap-4k.webp` | NASA star map panorama (J2000 equatorial) | Public domain |
| Stars | `public/textures/stars.bin` | Yale Bright Star Catalogue, 5th revised edition (Hoffleit & Warren 1991, NASA ADC / CDS V/50), packed by `scripts/build-sky.mjs` | Public domain |
| Moon | `public/textures/moon.webp` | NASA LRO LROC WAC global mosaic (NASA/GSFC/Arizona State University), via NASA Moon Trek | Public domain |
| Close-up Earth imagery | Streamed at run time, not in the repository | NASA [GIBS](https://www.earthdata.nasa.gov/gibs) `BlueMarble_ShadedRelief_Bathymetry` (Blue Marble with shaded relief and bathymetry) and `VIIRS_Black_Marble` (Black Marble 2016 night lights), 500 m tiles | Public domain |
| Share image | `public/og-image.png` | Original artwork for this project | MIT (same as the code) |
| Site icons | `public/favicon.*`, `public/apple-touch-icon.png`, `public/icons/` | Original artwork, generated by `scripts/build-icons.mjs` | MIT (same as the code) |

The first-paint textures are downscaled to 4096×2048 with ImageMagick. The
8K day and night maps (8192×4096, KTX2 / Basis UASTC and ETC1S, streamed after first
paint on capable desktops) are built from the full-resolution NASA files by
`scripts/build-earth-8k.mjs`, which checks their SHA-256. Exact commands and
hashes are in `public/textures/README.md`.

## Fonts

| Item | Files | Source | Licence |
|---|---|---|---|
| Space Grotesk | `public/fonts/space-grotesk-*.woff2` | [Space Grotesk](https://github.com/floriankarsten/space-grotesk) by Florian Karsten | SIL Open Font License 1.1 |
| Chivo Mono | `public/fonts/chivo-mono-*.woff2` | [Chivo](https://github.com/Omnibus-Type/Chivo) by Omnibus-Type | SIL Open Font License 1.1 |

Both are self-hosted latin / latin-ext subsets. The OFL permits bundling and
redistribution; it requires that the fonts not be sold on their own and that
modified versions not use the reserved names. See
[`public/fonts/OFL.txt`](public/fonts/OFL.txt).

## Software dependencies

- [three.js](https://threejs.org/) — MIT
- [React](https://react.dev/), [React Three Fiber](https://docs.pmnd.rs/react-three-fiber), [drei](https://github.com/pmndrs/drei) — MIT
- [satellite.js](https://github.com/shashwatak/satellite-js) — MIT
- [zustand](https://github.com/pmndrs/zustand) — MIT
- [camera-controls](https://github.com/yomotsu/camera-controls) — MIT
- [idb-keyval](https://github.com/jakearchibald/idb-keyval) — Apache-2.0
- [h5wasm](https://github.com/usnistgov/h5wasm) (reads NOAA's NetCDF4 files in `/api/clouds`) — NIST software notice; developed by the National Institute of Standards and Technology. Bundles [HDF5](https://www.hdfgroup.org/) — BSD-style
- [sharp](https://sharp.pixelplumbing.com/) (image encoding in `/api/clouds` and build scripts) — Apache-2.0
- [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/), [Vitest](https://vitest.dev/), [Tailwind CSS](https://tailwindcss.com/) — MIT (build-time)

## Trademarks

"Orbital" and the project's marks belong to their respective owners. NASA does
not endorse this project. The International Space Station is a joint project of
NASA, Roscosmos, ESA, JAXA and CSA; its name is used descriptively.
