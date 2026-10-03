import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { EARTH_RADIUS_KM } from '@/utils/constants'
import type { Vec3 } from '@/utils/math'

/**
 * SunFlare — the screen-space lens flare, as a composer pass.
 *
 * A halo centred on the sun plus three iris ghosts mirrored through the screen
 * centre along the flare axis. Two deliberate omissions from the earlier
 * iteration of this effect, both removed after review: no anamorphic streak
 * (it read as a laser line) and no lens rings.
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
 *   - the sun is not behind the Earth, with a soft limb (penumbra),
 *   - the sun is at or near the frame (a border fade so nothing pops at the
 *     edge),
 *   - and the shader itself blanks the flare inside the planet's disc, so it
 *     can never paint over the Earth.
 */

/** Angular softness of the Earth's limb, radians (~1.1°) */
const OCCLUSION_PENUMBRA_RAD = 0.02
/** NDC margin over which the flare fades as the sun leaves the frame. */
const FRAME_FADE_LO = -0.05
const FRAME_FADE_HI = 0.22

const _forward = new THREE.Vector3()
const _sunDir = new THREE.Vector3()
const _toCentre = new THREE.Vector3()
const _camSpace = new THREE.Vector3()
const _invQuat = new THREE.Quaternion()

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
    uHaloColor: { value: new THREE.Color('#ffc27a') },
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
    uniform vec3 uHaloColor;
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

      // Halo: a tight core plus a corona with COMPACT support. The previous
      // corona, exp(-d * 1.6) * 0.14, never reached zero and lifted ~79% of
      // the frame by ~31 levels: a grey veil, not a flare. Both terms now
      // vanish within HALO_R of the sun.
      const float HALO_R = 0.55;
      float d = length(p - sun);
      float core = exp(-d * 14.0) * 0.45;
      float corona = pow(max(0.0, 1.0 - d / HALO_R), 3.0) * 0.12;
      float halo = core + corona;

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
      // lens elements line up; the halo stays put.
      float central = 1.0 - smoothstep(0.2, 1.4, length(uSunNdc));

      vec3 flare = uHaloColor * (halo + ghostWarm * central) + uGhostColor * (ghostCool * central);
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
   * world direction from Earth's centre toward the sun — at 1 AU it is also,
   * to well under a pixel, the direction from the camera.
   */
  update(camera: THREE.PerspectiveCamera, sunDir: Vec3): void {
    const u = this.pass.uniforms
    _sunDir.set(sunDir.x, sunDir.y, sunDir.z)
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

    // Sun: occlusion by the Earth, then its screen position.
    _toCentre.copy(camera.position).multiplyScalar(-1).normalize()
    const angFromCentre = Math.acos(THREE.MathUtils.clamp(_toCentre.dot(_sunDir), -1, 1))
    const angEarth = Math.asin(Math.min(1, EARTH_RADIUS_KM / camDist))
    const occl = THREE.MathUtils.smoothstep(
      angFromCentre,
      angEarth - OCCLUSION_PENUMBRA_RAD,
      angEarth + OCCLUSION_PENUMBRA_RAD,
    )

    _camSpace.copy(_sunDir).applyQuaternion(_invQuat)
    const sunX = (_camSpace.x / -_camSpace.z) / halfAspect
    const sunY = (_camSpace.y / -_camSpace.z) / tanHalf

    // Earth centre, for the shader-side disc mask.
    _camSpace.copy(camera.position).multiplyScalar(-1).applyQuaternion(_invQuat)
    const earthX = (_camSpace.x / -_camSpace.z) / halfAspect
    const earthY = (_camSpace.y / -_camSpace.z) / tanHalf

    const edge = Math.min(1 - Math.abs(sunX), 1 - Math.abs(sunY))
    const frameFade = THREE.MathUtils.smoothstep(edge, FRAME_FADE_LO, FRAME_FADE_HI)

    ;(u.uSunNdc.value as THREE.Vector2).set(sunX, sunY)
    ;(u.uEarthNdc.value as THREE.Vector2).set(earthX, earthY)
    u.uEarthRadius.value = tanHalf > 0 ? Math.tan(angEarth) / tanHalf : 0
    u.uAspect.value = camera.aspect
    u.uStrength.value = occl * frameFade
  }
}
