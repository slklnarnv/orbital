varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
// Unit direction in the cloud deck's rotating frame (the deck is this mesh
// rotated by cloudRotation about +Y), so the shadow detail matches the shell.
varying vec3 vCloudDir;

uniform float cloudRotation;

void main() {
  vUv = uv;
  vec3 dir = normalize(position);
  float c = cos(cloudRotation);
  float s = sin(cloudRotation);
  vCloudDir = vec3(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c);
  vNormal = normalize(mat3(modelMatrix) * normal);

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
