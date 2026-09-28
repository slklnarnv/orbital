// Shared pass-through vertex shader for the camera-facing quads (the sun and
// the ISS tracking glint).
//
// It does NOT orient the quad: it only forwards UVs and applies the model-view
// transform. Facing is the caller's job — each of these meshes runs
// `lookAt(camera.position)` in its frame loop (see EnvironmentLayer and
// ISSModel), and `lookAt` also runs before billboarding while the camera is
// still at the origin, so it is load-bearing, not decorative.

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
