// Catalogue stars as sprites at infinity (SkyLayer.tsx). Positions are J2000
// unit vectors; uPrecession carries them to the equator of date, the frame
// of the sun and the Moon. Drawn on the far plane, so everything else hides
// them, and from the camera's direction only, so they never parallax.

uniform mat3 uPrecession;
uniform float uPixelRatio;
uniform float uZeroMagBrightness;
uniform float uMagSlope;
uniform float uBrightnessCap;
uniform float uSizeMin;
uniform float uSizeExtra;
uniform float uSizeGrowMag;
uniform float uSizeGrowRange;

attribute float aMag;
attribute vec3 aColor;

varying vec3 vColor;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

void main() {
  vec3 e = uPrecession * normalize(position);
  // TEME to world: (x, z, -y).
  vec3 dir = vec3(e.x, e.z, -e.y);
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * dir, 0.0);
  clip.z = clip.w * 0.999999;
  gl_Position = clip;

  float brightness = min(uBrightnessCap, uZeroMagBrightness * pow(10.0, -uMagSlope * aMag));
  float grow = clamp((uSizeGrowMag - aMag) / uSizeGrowRange, 0.0, 1.0);
  gl_PointSize = (uSizeMin + uSizeExtra * grow) * uPixelRatio;
  vColor = srgbToLinear(aColor) * brightness;
}
