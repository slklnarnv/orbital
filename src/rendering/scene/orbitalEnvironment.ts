import * as THREE from 'three'

/**
 * Orbital image-based lighting: what a surface on the station actually sees.
 *
 * From ~420 km the Earth fills a cone of half-angle asin(R / (R + h)) ≈ 70°
 * around nadir and everything else is black space. The environment map is
 * authored once in its own frame (Earth below, −Y) and the scene's
 * environmentRotation turns it so −Y follows the station's nadir — metallic
 * hardware then mirrors a blue Earth below and dark space above, instead of
 * the studio walls of RoomEnvironment. Its intensity follows how much of the
 * visible Earth is in daylight, with an eclipse fill for legibility.
 */

/** Angular radius of the Earth seen from ISS altitude (deg). */
export const EARTH_HALF_ANGLE_DEG = 70

/** environmentIntensity with the whole visible Earth in daylight. */
export const ORBITAL_ENV_INTENSITY = 0.45

/** Floor for a night-side Earth (airglow, city lights, starlight). */
export const ORBITAL_ENV_NIGHT_FLOOR = 0.03

/**
 * Environment level with the station in full shade. The app keeps the station
 * legible in eclipse (eclipseLighting's earthshine key light and exposure
 * boost); metallic hardware takes almost no diffuse light, so the environment
 * follows the same rule or bare metal turns black at night. Matches the
 * studio environment's old constant 0.28.
 */
export const ORBITAL_ENV_ECLIPSE_FILL = 0.28

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Linear radiance. The disc mixes ocean blue with cloud white; the thin
// limb band is the atmosphere seen edge-on. Values are relative — the
// absolute level is set by scene.environmentIntensity.
const fragmentShader = /* glsl */ `
  uniform float uCosHalfAngle;
  varying vec3 vDirection;
  void main() {
    vec3 d = normalize(vDirection);
    float cosNadir = -d.y;
    float disc = smoothstep(uCosHalfAngle - 0.015, uCosHalfAngle + 0.015, cosNadir);
    // Brighter toward the centre of the disc (higher sun / less atmosphere path).
    vec3 earth = mix(vec3(0.22, 0.33, 0.52), vec3(0.42, 0.52, 0.66), smoothstep(uCosHalfAngle, 1.0, cosNadir));
    float limb = exp(-pow((cosNadir - uCosHalfAngle) / 0.035, 2.0));
    vec3 radiance = earth * disc + vec3(0.30, 0.52, 0.95) * limb * 0.8;
    gl_FragColor = vec4(radiance, 1.0);
  }
`

/** The scene PMREMGenerator.fromScene turns into the environment map. */
export function createOrbitalEnvironmentScene(): { scene: THREE.Scene; dispose: () => void } {
  const scene = new THREE.Scene()
  const geometry = new THREE.SphereGeometry(1, 64, 32)
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uCosHalfAngle: { value: Math.cos(THREE.MathUtils.degToRad(EARTH_HALF_ANGLE_DEG)) } },
    side: THREE.BackSide,
    depthWrite: false,
  })
  scene.add(new THREE.Mesh(geometry, material))
  return {
    scene,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

const DOWN = new THREE.Vector3(0, -1, 0)
const _nadir = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _m = new THREE.Matrix4()

/**
 * scene.environmentRotation that puts the map's −Y (Earth) on `nadirWorld`.
 *
 * three samples the map at M · d with M = R(−x, −y, −z) built from this Euler
 * (WebGLMaterials negates the angles for PMREM/cube-UV maps). We need
 * M · nadir = −Y, so M is the rotation nadir → −Y; decomposing M and negating
 * its angles in the same order reproduces it exactly — no Euler-inverse
 * approximation.
 */
export function environmentRotationForNadir(nadirWorld: THREE.Vector3, out: THREE.Euler): THREE.Euler {
  _nadir.copy(nadirWorld).normalize()
  _q.setFromUnitVectors(_nadir, DOWN)
  out.setFromRotationMatrix(_m.makeRotationFromQuaternion(_q), 'XYZ')
  out.set(-out.x, -out.y, -out.z, 'XYZ')
  return out
}

/**
 * Relative brightness of the Earth below (0 night … 1 subsolar), from the
 * cosine of the sun's zenith angle at the sub-station point. The visible cap
 * spans ~±20° of arc, so it is fully lit below ~70° zenith and fully dark
 * beyond ~110°; within daylight the radiance falls with the sun's elevation.
 */
export function earthBelowBrightness(cosSunZenith: number): number {
  const c = Math.max(-1, Math.min(1, cosSunZenith))
  const lit = THREE.MathUtils.smoothstep(c, -0.34, 0.34)
  return lit * (0.35 + 0.65 * Math.max(0, c))
}

const _up = new THREE.Vector3()
const _down = new THREE.Vector3()

/**
 * environmentIntensity from the daylight below and the station's shade
 * (1 − sun visibility): the physical Earth-below level, never darker than
 * the eclipse legibility fill while the station is shaded.
 */
export function orbitalEnvironmentIntensity(cosSunZenith: number, shade: number): number {
  const daylight =
    ORBITAL_ENV_NIGHT_FLOOR + (ORBITAL_ENV_INTENSITY - ORBITAL_ENV_NIGHT_FLOOR) * earthBelowBrightness(cosSunZenith)
  const s = Math.max(0, Math.min(1, shade))
  return Math.max(daylight, ORBITAL_ENV_ECLIPSE_FILL * s)
}

/**
 * Point the orbital environment at the station's nadir and set its level.
 * Called from the ISS frame loop with the station's world position (Earth at
 * the origin), the unit sun direction and the station's shade.
 */
export function orientOrbitalEnvironment(
  scene: THREE.Scene,
  stationWorld: THREE.Vector3,
  sunDirection: THREE.Vector3,
  shade: number,
): void {
  if (stationWorld.lengthSq() === 0) return
  _up.copy(stationWorld).normalize()
  environmentRotationForNadir(_down.copy(_up).negate(), scene.environmentRotation)
  scene.environmentIntensity = orbitalEnvironmentIntensity(_up.dot(sunDirection), shade)
}
