import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { ATMOSPHERE_RADIUS } from './EarthConstants'
import vertexShader from '../shaders/atmosphere.vert'
import fragmentShader from '../shaders/atmosphere.frag'

/**
 * AtmosphereShell renders the outer glowing rim of the Earth.
 *
 * It uses a custom ShaderMaterial with a Fresnel effect. By rendering
 * on the BackSide and using AdditiveBlending, it creates a soft, glowing halo
 * around the planetary limb that is colored blue on the dayside and transitions
 * to warm dawn/dusk colors at the solar terminator.
 */
export function AtmosphereShell(): JSX.Element {
  // Setup stable uniforms reference
  const uniformsRef = useRef({
    sunDirection: { value: new THREE.Vector3(0, 0, 1) },
  })

  useFrame(() => {
    const simTime = simulationClock.now()
    const sunDir = sunDirectionWorld(simTime.julianDate)

    // Dynamically update the solar angle for terminator tint calculation
    uniformsRef.current.sunDirection.value.set(sunDir.x, sunDir.y, sunDir.z)
  })

  return (
    <mesh position={[0, 0, 0]}>
      {/* Atmosphere shell is ~6,530 km in radius */}
      <sphereGeometry args={[ATMOSPHERE_RADIUS, 64, 64]} />
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
