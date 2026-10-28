// The Milky Way panorama: NASA SVS Deep Star Maps, equirectangular in J2000
// right ascension and declination (RA 0h at the centre, increasing to the
// left; north up). Sampled by direction, so it lines up with the catalogue
// stars exactly, wherever the camera is.

uniform sampler2D uMap;
// Equator of date to J2000: the transpose of the catalogue's precession.
uniform mat3 uPrecessionInverse;
uniform float uOpacity;

varying vec3 vDir;

const float PI = 3.141592653589793;

void main() {
  vec3 w = normalize(vDir);
  // World to TEME: (x, -z, y); then back to J2000.
  vec3 e = uPrecessionInverse * vec3(w.x, -w.z, w.y);
  float ra = atan(e.y, e.x);
  float dec = asin(clamp(e.z, -1.0, 1.0));
  vec2 uv = vec2(0.5 - ra / (2.0 * PI), 0.5 + dec / PI);
  // The u coordinate wraps at RA 12h; take derivatives from a copy shifted
  // half a turn so the wrap does not read as a huge footprint (no seam line).
  float uShift = fract(uv.x + 0.5);
  vec2 dx = vec2(dFdx(uv.x), dFdx(uv.y));
  vec2 dy = vec2(dFdy(uv.x), dFdy(uv.y));
  if (abs(dFdx(uShift)) < abs(dx.x)) dx.x = dFdx(uShift);
  if (abs(dFdy(uShift)) < abs(dy.x)) dy.x = dFdy(uShift);
  vec3 color = textureGrad(uMap, uv, dx, dy).rgb;
  // Blended over black at uOpacity, untonemapped: the old sphere's look.
  gl_FragColor = vec4(color, uOpacity);
  #include <colorspace_fragment>
}
