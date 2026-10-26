// Screen-space quad centred on the sun's projected position. It ignores the
// model, view and projection matrices: the CPU projects the sun billboard's
// centre (SunGlare.ts) and the quad is laid out directly in clip space, so the
// glare is round on screen whatever the field of view or the sun's place in
// the frame — a lens effect lives on the sensor, not in the world.
//
// vOffset is the fragment's offset from the sun in NDC-height units (x already
// corrected for aspect), the unit every radius in sunGlare.frag is written in.

uniform vec2 uSunNdc;
uniform float uAspect;
uniform float uRadius;

varying vec2 vOffset;

void main() {
  vOffset = position.xy * uRadius;
  gl_Position = vec4(uSunNdc + vec2(vOffset.x / uAspect, vOffset.y), 0.0, 1.0);
}
