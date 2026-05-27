import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { EarthSurface } from './EarthSurface'
import { CloudLayer } from './CloudLayer'
import { AtmosphereShell } from './AtmosphereShell'

/**
 * EarthGroup represents the entire Earth coordinate frame.
 *
 * It rotates around the Y-axis by the Greenwich Mean Sidereal Time (GMST)
 * in radians on every frame. This represents the Earth-Centered Earth-Fixed (ECEF)
 * rotation, ensuring the terrain aligns perfectly with propagated satellite coordinates.
 */
export function EarthGroup(): JSX.Element {
  const groupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!groupRef.current) return
    const simTime = simulationClock.now()

    // Rotate the Earth frame by GMST (Greenwich Mean Sidereal Time in radians)
    // This aligns the physical longitude lines with the ECI/TEME propagation coordinates
    groupRef.current.rotation.y = simTime.gmst
  })

  return (
    <group ref={groupRef}>
      {/* 1. Solid Earth terrain with day/night texture blending and specular highlights */}
      <EarthSurface />

      {/* 2. Slow-rotating cloud deck at 1.003× radius */}
      <CloudLayer />

      {/* 3. Outer atmospheric glowing shell at 1.025× radius */}
      <AtmosphereShell />
    </group>
  )
}
