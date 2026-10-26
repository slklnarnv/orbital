varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
// Unit direction in the cloud deck's own rotating frame: the domain of the
// close-range detail noise (cloudDensity.glsl).
varying vec3 vCloudDir;

void main() {
  vUv = uv;
  vCloudDir = normalize(position);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
