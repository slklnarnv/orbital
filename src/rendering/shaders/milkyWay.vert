// The Milky Way panorama (SkyLayer.tsx): a unit sphere drawn from the
// camera's direction only, on the far plane, behind everything.

varying vec3 vDir;

void main() {
  vDir = position;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 0.0);
  clip.z = clip.w * 0.999999;
  gl_Position = clip;
}
