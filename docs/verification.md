# Browser verification

Run these checks against a production build in a hardware-accelerated browser after
camera, shader, asset, or scene changes.

## Camera drag sensitivity

1. At approximately 35,000 km Earth-center distance, perform a 100-pixel horizontal
   left drag and record the azimuth change.
2. Repeat at the 6,500 km minimum distance.
3. Confirm the close-view rotation is under 10% of the far-view rotation, changes
   smoothly while zooming, and does not affect pan, dolly, Locate, or ISS tracking.

## Shader portability

1. Open the production preview before collecting console messages.
2. Confirm there are no WebGL shader compile or program-link errors.
3. Inspect the Earth day side, city lights on the night side, the terminator, cloud
   limb, atmosphere limb, sun disc, and lens ring for gross visual regressions.
4. Record the browser, WebGL version, and renderer class with the smoke result.
