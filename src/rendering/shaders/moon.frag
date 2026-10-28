// The Moon's surface: LRO WAC albedo, lit by the sun with Lommel–Seeliger
// (regolith has no limb darkening, so the full Moon looks flat, as it does),
// a trace of earthshine on the night side, and Earth's shadow for lunar
// eclipses (penumbra fading into a dim red umbra). Capped under the bloom
// threshold.

uniform sampler2D uMap;
uniform vec3 uSunDir;
uniform float uSunGain;
uniform float uEarthshine;
uniform float uRadianceCap;

varying vec3 vNormal;
varying vec3 vSurface;
varying vec2 vUv;

const float EARTH_SHADOW_R = 6371.0 * 1.02; // the atmosphere widens the shadow ~2%
const float TAN_UMBRA = 0.004618;           // tan 0.2646°: the umbra's taper
const float TAN_PENUMBRA = 0.004706;        // tan 0.2696°: the penumbra's flare

void main() {
  vec3 n = normalize(vNormal);
  vec3 toEye = normalize(cameraPosition - vSurface);
  float mu0 = max(dot(n, uSunDir), 0.0);
  float mu = max(dot(n, toEye), 0.0);
  float lit = mu0 + mu > 0.0 ? 2.0 * mu0 / (mu0 + mu) : 0.0;

  // Earth's shadow: distance of this point from the anti-sun axis.
  float along = dot(vSurface, uSunDir);
  float shadow = 1.0;
  vec3 umbraTint = vec3(1.0);
  if (along < 0.0) {
    float off = length(vSurface - along * uSunDir);
    float umbra = EARTH_SHADOW_R + along * TAN_UMBRA;
    float penumbra = EARTH_SHADOW_R - along * TAN_PENUMBRA;
    float t = smoothstep(umbra, penumbra, off);
    // Sunlight bent through Earth's atmosphere leaves the umbra a dim red.
    shadow = mix(0.12, 1.0, t);
    umbraTint = mix(vec3(1.0, 0.35, 0.18), vec3(1.0), t);
  }

  // Earthshine follows Earth's phase as seen from the Moon: full at new Moon.
  float earthPhase = 0.5 * (1.0 + dot(normalize(vSurface), uSunDir));

  vec3 albedo = texture2D(uMap, vUv).rgb;
  vec3 radiance = albedo * (uSunGain * lit * shadow * umbraTint + uEarthshine * earthPhase);
  gl_FragColor = vec4(min(radiance, vec3(uRadianceCap)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
