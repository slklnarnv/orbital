# Runtime texture assets

The active Earth and starmap textures are capped at 4096x2048 so their decoded GPU
allocation and network transfer remain appropriate for a browser application. The
source imagery is derived from the project's original NASA Blue Marble, Black
Marble, cloud, ocean-specular, and starmap assets.

The runtime files were generated from the original source assets with ImageMagick:

```sh
magick bluemarblewebp.webp -resize 4096x2048\! -strip -quality 84 -define webp:method=6 earth-day-4k.webp
magick BlackMarblewebp.webp -resize 4096x2048\! -strip -quality 82 -define webp:method=6 earth-night-4k.webp
magick 8k_earth_clouds.jpg -resize 4096x2048\! -strip -quality 82 -define webp:method=6 earth-clouds-4k.webp
magick 8k_earth_specular_map.png -resize 4096x2048\! -colorspace Gray -strip -quality 90 -define webp:lossless=true -define webp:method=6 earth-specular-4k.webp
magick starmap-4k.jpg -resize 4096x2048\! -strip -quality 84 -define webp:method=6 starmap-4k.webp
```

Run `npm run check:assets` after changing runtime assets. The check enforces file
size, image dimensions, the aggregate initial asset budget, and deferred loading
and a separate size ceiling for the detailed ISS model.
