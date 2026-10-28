# Runtime texture assets

The first-paint Earth and starmap textures are capped at 4096x2048 so their decoded
GPU allocation and network transfer remain appropriate for a browser application. The
source imagery is derived from the project's original NASA Blue Marble, Black
Marble, cloud, ocean-specular, and starmap assets.

Identified sources (2026-10-26, by comparing each map with candidate NASA images
downscaled to 1024x512; RMSE in 8-bit levels):

- `earth-day-4k.webp`: NASA Blue Marble Next Generation, July 2004, with topography
  and bathymetry (`world.topo.bathy.200407`, Visible Earth record 73751). RMSE 2.6,
  against 4.3 for August and 16.4 for June.
- `earth-night-4k.webp`: NASA Black Marble 2016 (`BlackMarble_2016`, Visible Earth
  record 144898). RMSE 1.9, against 16.1 for the 2012 composite.

The runtime files were generated from the original source assets with ImageMagick:

```sh
magick bluemarblewebp.webp -resize 4096x2048\! -strip -quality 92 -define webp:method=6 earth-day-4k.webp
magick BlackMarblewebp.webp -resize 4096x2048\! -strip -quality 82 -define webp:method=6 earth-night-4k.webp
magick 8k_earth_clouds.jpg -resize 4096x2048\! -strip -quality 82 -define webp:method=6 earth-clouds-4k.webp
magick 8k_earth_specular_map.png -resize 4096x2048\! -colorspace Gray -strip -quality 90 -define webp:lossless=true -define webp:method=6 earth-specular-4k.webp
magick starmap-4k.jpg -resize 4096x2048\! -strip -quality 84 -define webp:method=6 starmap-4k.webp
```

Run `npm run check:assets` after changing runtime assets. The check enforces file
size, image dimensions, the aggregate initial asset budget, and deferred loading
and a separate size ceiling for the detailed ISS model.

## Deferred 8K maps (plan 017 V2)

`earth-day-8k.ktx2` (Basis UASTC, 20.5 MiB) and `earth-night-8k.ktx2` (Basis ETC1S,
1.4 MiB) are 8192x4096 KTX2 with a full mip chain. They are not part of first paint: after it, capable desktops
(`MAX_TEXTURE_SIZE` >= 8192, a fine pointer, no Save-Data, a GPU compressed format)
stream them and swap them in (`src/rendering/earth/useEarthDetailUpgrade.ts`).
Everyone else keeps the 4K WebP maps. `npm run check:assets` caps them as deferred
assets (24 MiB / 3 MiB), off the 5 MiB initial budget.

Built by `npm run build:earth-8k` (`scripts/build-earth-8k.mjs`; needs KTX-Software
>= 4.3, `KTX_BIN` if `ktx` is not on PATH) from the public-domain NASA originals:

| Map | Source file | SHA-256 |
|---|---|---|
| Day | <https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x21600x10800.jpg> (21600x10800) | `d225f1f35a6448a4d1d8f6de6e48f3433e470085b70a35800e64f384f269a7b0` |
| Night | <https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg> (13500x6750) | `230aac448ae68c358be433dd518888cccb3a85ccf66f7b44326441c324ad6725` |

Steps: download (cached in `.tmp-earth-build/`), verify the hash, resize to 8192x4096
(Lanczos 3), flip vertically (three uploads compressed textures without `flipY`, and
the sphere's UVs expect the flipped convention of the WebP maps), then `ktx create`:

- night: `--format R8G8B8_SRGB --assign-oetf srgb --encode basis-lz --clevel 2
  --qlevel 255 --generate-mipmap` (ETC1S, the same arguments as the ISS textures);
- day: `--format R8G8B8_SRGB --assign-oetf srgb --encode uastc --uastc-quality 2
  --uastc-rdo --uastc-rdo-l 1 --zstd 22 --generate-mipmap` (UASTC).

Codec choice, measured against the 8K masters (PSNR, dB):

| | Day | Night | Day file |
|---|---|---|---|
| Today's 4K WebP, upscaled | 31.6 | 33.3 | 1.0 MB |
| 8K ETC1S | 35.3 | **38.2** (shipped, 1.4 MiB) | 4.1 MiB |
| 8K UASTC + RDO λ 4 + zstd | 39.1 | — | 16.7 MiB |
| 8K UASTC + RDO λ 1 + zstd | **44.6** (shipped) | — | 20.5 MiB |

ETC1S would have been a quarter of the day map's size, but magnified the way the app
shows the ground from orbit (bilinear, ~4 px per texel) it leaves light-blue 4×4
block halos along every coastline. The night map has no such edges, and ETC1S keeps
its city lights sharp.

On the GPU every 8K map transcodes to 1 byte per texel on desktops (BC7 or ASTC),
42.7 MiB with mips, the same as the 4K RGBA8 map it replaces. That map's GPU copy
is released after the swap.
