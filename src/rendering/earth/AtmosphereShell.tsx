import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import {
  ATMOSPHERE_SCALE_HEIGHT_KM,
  SUN_TANGENT_TAU,
  sunElevationAboveLimb,
} from '@/core/orbital/SunAppearance'
import { SUN_BILLBOARD_DISTANCE_KM } from '@/utils/constants'
import { ATMOSPHERE_RADIUS, EARTH_SPHERE_SEGMENTS } from './EarthConstants'
import vertexShader from '../shaders/atmosphere.vert'
import fragmentShader from '../shaders/atmosphere.frag'

/** The sunrise band fades in as the visible sun comes within this many
 *  radians above the limb (and stays on at and behind it). */
const SUNRISE_BAND_FULL_RAD = THREE.MathUtils.degToRad(3)
const SUNRISE_BAND_NONE_RAD = THREE.MathUtils.degToRad(10)

/**
 * AtmosphereShell renders the outer glowing rim of the Earth.
 *
 * It uses a custom ShaderMaterial with a Fresnel effect. By rendering
 * on the BackSide and using AdditiveBlending, it creates a soft, glowing halo
 * around the planetary limb that is colored blue on the dayside and transitions
 * to warm dawn/dusk colors at the solar terminator. With the sun at or behind
 * the limb as seen from the camera, it adds the forward-scattered sunrise
 * band around the sun's position (atmosphere.frag).
 */
export function AtmosphereShell(): JSX.Element {
  // Setup stable uniforms reference
  const uniformsRef = useRef({
    sunDirection: { value: new THREE.Vector3(0, 0, 1) },
    sunBillboard: { value: new THREE.Vector3(0, 0, SUN_BILLBOARD_DISTANCE_KM) },
    limbProximity: { value: 0 },
    atmTau: { value: new THREE.Vector3(...SUN_TANGENT_TAU) },
    atmScaleHeight: { value: ATMOSPHERE_SCALE_HEIGHT_KM },
  })

  useFrame((state) => {
    const simTime = simulationClock.now()
    const sunDir = sunDirectionWorld(simTime.julianDate)
    const u = uniformsRef.current

    // Dynamically update the solar angle for terminator tint calculation
    u.sunDirection.value.set(sunDir.x, sunDir.y, sunDir.z)

    // The visible sun (the billboard, as EnvironmentLayer places it) and how
    // close it sits to the limb from here: the sunrise band's gate.
    u.sunBillboard.value.set(sunDir.x, sunDir.y, sunDir.z).multiplyScalar(SUN_BILLBOARD_DISTANCE_KM)
    const elevation = sunElevationAboveLimb(state.camera.position, u.sunBillboard.value)
    u.limbProximity.value = 1 - THREE.MathUtils.smoothstep(elevation, SUNRISE_BAND_FULL_RAD, SUNRISE_BAND_NONE_RAD)
  })

  return (
    <mesh position={[0, 0, 0]}>
      {/* Atmosphere shell is ~6,530 km in radius */}
      <sphereGeometry args={[ATMOSPHERE_RADIUS, EARTH_SPHERE_SEGMENTS, EARTH_SPHERE_SEGMENTS]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniformsRef.current}
        side={THREE.BackSide} // Render back faces to project glow outside Earth borders
        blending={THREE.AdditiveBlending} // Blend starlight behind the halo smoothly
        transparent={true}
        depthWrite={false} // Avoid occluding orbital objects (like ISS) in front
        depthTest={true}
      />
    </mesh>
  )
}
