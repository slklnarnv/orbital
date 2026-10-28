// The sun billboard's vertex shader: `billboard.vert` plus the fragment's
// world position, which `sun.frag` needs to find each pixel's line of sight
// through the atmosphere. Facing is the caller's job (EnvironmentLayer runs
// `lookAt(camera.position)` every frame), exactly as for billboard.vert.

varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
