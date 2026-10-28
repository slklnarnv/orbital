// The Moon (MoonLayer.tsx): a unit sphere placed along its true direction
// from the camera at MOON_DRAW_DISTANCE_KM and scaled to its true apparent
// size. Done here, from the camera that draws the frame, so flights that set
// the camera after the frame callbacks still see it in the right place.

uniform vec3 uMoonCenter;   // true geocentric position, world km
uniform float uMoonRadius;  // km
uniform float uDrawDistance;
uniform mat3 uMoonBasis;    // body frame: +x to Earth, +y lunar north

varying vec3 vNormal;       // world
varying vec3 vSurface;      // true world position of this surface point
varying vec2 vUv;

void main() {
  vec3 n = uMoonBasis * position;
  vec3 toMoon = uMoonCenter - cameraPosition;
  float k = uDrawDistance / length(toMoon);
  vec3 drawn = cameraPosition + (toMoon + n * uMoonRadius) * k;
  vNormal = n;
  vSurface = uMoonCenter + n * uMoonRadius;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(drawn, 1.0);
}
