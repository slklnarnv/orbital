// ─── Orbit Prediction Line — Vertex Shader ───────────────────────────────────
//
// Receives a custom per-vertex "alpha" attribute set by OrbitLine.tsx.
// Alpha encodes the temporal position along the prediction arc:
//   0.0 → trailing edge (past orbit history)
//   1.0 → leading edge (future prediction)
//
// No lighting calculations — the orbit line is purely emissive/additive.

attribute float alpha;

varying float vAlpha;

void main() {
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
