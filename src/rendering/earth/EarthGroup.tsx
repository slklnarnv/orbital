import type { JSX } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { EarthSurface } from './EarthSurface'
import { CloudLayer } from './CloudLayer'
import { AtmosphereShell } from './AtmosphereShell'
import { LiveClouds } from './liveClouds'
import { GroundTrack } from './GroundTrack'
import { useHudStore } from '@/stores/hudStore'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * EarthGroup represents the entire Earth coordinate frame.
 *
 * It rotates around the Y-axis by the Greenwich Mean Sidereal Time (GMST)
 * in radians on every frame. This represents the Earth-Centered Earth-Fixed (ECEF)
 * rotation, ensuring the terrain aligns perfectly with propagated satellite coordinates.
 */
export function EarthGroup(): JSX.Element {
  const groupRef = useRef<THREE.Group>(null)
  const groundTrack = useSettingsStore((state) => state.groundTrack)
  // The 3D track and footprint are annotations: they hide with the HUD (`H`).
  const hudHidden = useHudStore((state) => state.hidden)
  // Today's clouds (NOAA, hourly), shared by the cloud shell and the shadows.
  const { gl } = useThree()
  const clouds = useMemo(() => new LiveClouds(gl), [gl])
  useEffect(() => {
    clouds.start()
    return () => clouds.dispose()
  }, [clouds])

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
      <EarthSurface clouds={clouds} />

      {/* 2. Cloud deck at 1.003× radius: live clouds, or the drifting composite */}
      <CloudLayer clouds={clouds} />

      {/* 3. Outer atmospheric glowing shell at 1.025× radius */}
      <AtmosphereShell />

      {/* 4. Optional ground track + visibility footprint (Earth-fixed lines) */}
      {groundTrack && !hudHidden && <GroundTrack />}
    </group>
  )
}
