// A star's sprite: a small Gaussian, so a 1.6 px star is a soft point and a
// bright one a slightly larger, still round, disc (additive).

varying vec3 vColor;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float profile = exp(-3.0 * d * d) * (1.0 - smoothstep(0.75, 1.0, d));
  gl_FragColor = vec4(vColor * profile, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
