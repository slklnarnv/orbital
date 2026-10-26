import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { EARTH_RADIUS_KM, SUN_BILLBOARD_DISTANCE_KM } from '@/utils/constants'
import type { Vec3 } from '@/utils/math'
import { sunGlareState } from '../scene/sunGlareConfig'

/**
 * SunFlare — the screen-space lens flare, as a composer pass.
 *
 * Three iris ghosts mirrored through the screen centre along the flare axis.
 * Deliberate omissions, each removed after review: no anamorphic streak (it
 * read as a laser line), no lens rings, and — since the sun glare (SunGlare,
 * in the scene for both pipelines) draws the camera's halo and diffraction
 * spikes — no halo of its own, which only doubled that glare.
 *
 * It is a POST pass, so the whole effect is added in LINEAR space before
 * OutputPass tone-maps the frame — the same space every other material works
 * in, which is what keeps it consistent across the compositing toggle. Being a
 * pass also means it exists only while the composer does; the settings UI
 * disables the switch when Bloom is off rather than silently doing nothing.
 *
 * Gating is per frame, on the CPU:
 *   - the sun is in front of the camera at all (a dot-product guard — never
 *     project() the sun when it is behind the camera, that returns mirrored
 *     garbage),
 *   - the sun is actually seen: `sunGlareState.visibility`, the glare's own
 *     strength (its flux through the atmosphere, fading as the disc sets
 *     behind the limb, times its visibility past the station), so flare
 *     and glare always fade together,
 *   - the sun is at or near the frame (a border fade so nothing pops at the
 *     edge),
 *   - and the shader itself blanks the flare inside the planet's disc, so it
 *     can never paint over the Earth.
 */

/** NDC margin over which the flare fades as the sun leaves the frame. */
const FRAME_FADE_LO = -0.05
const FRAME_FADE_HI = 0.22

const _forward = new THREE.Vector3()
const _sunDir = new THREE.Vector3()
const _camSpace = new THREE.Vector3()
const _invQuat = new THREE.Quaternion()

/**
 * Radius of the shader-side Earth disc mask, in the shader's NDC-height units.
 * When Earth's centre is at or behind the camera plane (`earthCamZ >= 0`) the
 * projection would mirror the disc onto the screen and could blank the whole
 * flare, so a negative radius is returned: `earthMask` is then 1 everywhere
 * and the sun-visibility gate still sets `uStrength`.
 */
export function earthMaskRadius(earthCamZ: number, angEarth: number, tanHalf: number): number {
  if (earthCamZ >= 0) return -1
  return tanHalf > 0 ? Math.tan(angEarth) / tanHalf : 0
}

const SunFlareShader = {
  name: 'SunFlareShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** Sun position in NDC (-1..1). */
    uSunNdc: { value: new THREE.Vector2(0, 0) },
    /** Earth centre in NDC, and its radius in the flare's frame units. */
    uEarthNdc: { value: new THREE.Vector2(0, 0) },
    uEarthRadius: { value: 0 },
    uAspect: { value: 1 },
    uStrength: { value: 0 },
    uWarmColor: { value: new THREE.Color('#ffc27a') },
    uGhostColor: { value: new THREE.Color('#9fc4ff') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSunNdc;
    uniform vec2 uEarthNdc;
    uniform float uEarthRadius;
    uniform float uAspect;
    uniform float uStrength;
    uniform vec3 uWarmColor;
    uniform vec3 uGhostColor;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.002) {
        gl_FragColor = base;
        return;
      }

      // Frame space: x scaled by aspect, y in [-1, 1] across the viewport.
      vec2 scale = vec2(uAspect, 1.0);
      vec2 p = (vUv * 2.0 - 1.0) * scale;
      vec2 sun = uSunNdc * scale;
      vec2 earth = uEarthNdc * scale;

      // Never paint over the planet.
      float earthMask = smoothstep(uEarthRadius - 0.01, uEarthRadius + 0.01, length(p - earth));

      // Iris ghosts mirrored through the screen centre: soft-edged discs
      // (zero outside their radius), wider and fainter with distance, as an
      // out-of-focus aperture image should be. Ascending smoothstep edges
      // only (the shader-ramp check rejects reversed ones).
      vec2 axis = -sun;
      float g1 = 1.0 - smoothstep(0.022, 0.040, length(p - axis * 0.45));
      float g2 = 1.0 - smoothstep(0.045, 0.075, length(p - axis * 0.85));
      float g3 = 1.0 - smoothstep(0.080, 0.125, length(p - axis * 1.30));
      float ghostWarm = g1 * 0.08;
      float ghostCool = g2 * 0.05 + g3 * 0.03;

      // Ghosts are strongest with the sun near the frame centre, as the
      // lens elements line up.
      float central = 1.0 - smoothstep(0.2, 1.4, length(uSunNdc));

      vec3 flare = uWarmColor * (ghostWarm * central) + uGhostColor * (ghostCool * central);
      gl_FragColor = vec4(base.rgb + flare * (uStrength * earthMask), base.a);
    }
  `,
}

export class SunFlare {
  readonly pass: ShaderPass

  constructor() {
    this.pass = new ShaderPass(SunFlareShader)
    this.pass.enabled = false
  }

  /**
   * Aim and gate the flare for the frame about to be drawn. `sunDir` is the
   * world direction from Earth's centre toward the sun. The flare aims at the
   * sun BILLBOARD (drawn at SUN_BILLBOARD_DISTANCE_KM along it), not along
   * `sunDir` itself: from a camera tens of thousands of km off-centre the two
   * differ by several degrees of parallax, which detached the flare from the
   * visible disc.
   */
  update(camera: THREE.PerspectiveCamera, sunDir: Vec3): void {
    const u = this.pass.uniforms
    _sunDir
      .set(sunDir.x, sunDir.y, sunDir.z)
      .multiplyScalar(SUN_BILLBOARD_DISTANCE_KM)
      .sub(camera.position)
      .normalize()
    const camDist = camera.position.length()
    if (camDist <= EARTH_RADIUS_KM) {
      u.uStrength.value = 0
      return
    }

    // Behind-the-camera guard (see the module doc).
    _forward.set(0, 0, -1).applyQuaternion(camera.quaternion)
    if (_forward.dot(_sunDir) <= 0.02) {
      u.uStrength.value = 0
      return
    }

    _invQuat.copy(camera.quaternion).invert()
    const tanHalf = Math.tan((camera.getEffectiveFOV() * Math.PI) / 360)
    const halfAspect = tanHalf * camera.aspect

    // Sun: its screen position. Occlusion (Earth, atmosphere, station) is
    // the glare's, read from sunGlareState below.
    const angEarth = Math.asin(Math.min(1, EARTH_RADIUS_KM / camDist))

    _camSpace.copy(_sunDir).applyQuaternion(_invQuat)
    const sunX = (_camSpace.x / -_camSpace.z) / halfAspect
    const sunY = (_camSpace.y / -_camSpace.z) / tanHalf

    // Earth centre, for the shader-side disc mask.
    _camSpace.copy(camera.position).multiplyScalar(-1).applyQuaternion(_invQuat)
    // Behind the camera plane the projection would mirror the disc (and divide
    // by ~0 at the plane), so park the centre at a finite point; the mask is
    // disabled below via a negative radius.
    const earthInFront = _camSpace.z < 0
    const earthX = earthInFront ? (_camSpace.x / -_camSpace.z) / halfAspect : 0
    const earthY = earthInFront ? (_camSpace.y / -_camSpace.z) / tanHalf : 0

    const edge = Math.min(1 - Math.abs(sunX), 1 - Math.abs(sunY))
    const frameFade = THREE.MathUtils.smoothstep(edge, FRAME_FADE_LO, FRAME_FADE_HI)

    ;(u.uSunNdc.value as THREE.Vector2).set(sunX, sunY)
    ;(u.uEarthNdc.value as THREE.Vector2).set(earthX, earthY)
    u.uEarthRadius.value = earthMaskRadius(_camSpace.z, angEarth, tanHalf)
    u.uAspect.value = camera.aspect
    u.uStrength.value = sunGlareState.visibility * frameFade
  }
}
