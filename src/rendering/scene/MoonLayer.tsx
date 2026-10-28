import type { JSX } from 'react'
import React, { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { moonPositionTEME } from '@/core/orbital/MoonEphemeris'
import { JULIAN_DATE_J2000 } from '@/utils/constants'
import { assetUrl } from '@/utils/assetUrl'
import {
  MOON_DRAW_DISTANCE_KM,
  MOON_EARTHSHINE,
  MOON_RADIANCE_CAP,
  MOON_RADIUS_KM,
  MOON_SUN_GAIN,
} from './skyConfig'
import moonVert from '../shaders/moon.vert'
import moonFrag from '../shaders/moon.frag'

const MOON_URL = assetUrl('/textures/moon.webp')

const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _basis = new THREE.Matrix4()

/**
 * The Moon at its true position and phase (MoonEphemeris), lit by the same
 * sun as the Earth. The near side faces Earth (librations of up to ~8° are
 * left out); its axis is taken as the ecliptic pole (the true one is 1.5°
 * off). Mounted under its own Suspense: the map never holds up first paint.
 */
export const MoonLayer = React.memo(function MoonLayer(): JSX.Element {
  const { gl } = useThree()
  const map = useTexture(MOON_URL)
  useEffect(() => {
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy())
    map.needsUpdate = true
  }, [map, gl])

  const uniforms = useMemo(() => ({
    uMap: { value: map },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunGain: { value: MOON_SUN_GAIN },
    uEarthshine: { value: MOON_EARTHSHINE },
    uRadianceCap: { value: MOON_RADIANCE_CAP },
    uMoonCenter: { value: new THREE.Vector3(384_400, 0, 0) },
    uMoonRadius: { value: MOON_RADIUS_KM },
    uDrawDistance: { value: MOON_DRAW_DISTANCE_KM },
    uMoonBasis: { value: new THREE.Matrix3() },
  }), [map])

  useFrame(() => {
    const jd = simulationClock.now().julianDate
    const sun = sunDirectionWorld(jd)
    uniforms.uSunDir.value.set(sun.x, sun.y, sun.z).normalize()
    // TEME to world: (x, z, -y).
    const m = moonPositionTEME(jd)
    const center = uniforms.uMoonCenter.value.set(m.x, m.z, -m.y)
    // Body frame: +x toward Earth (longitude 0), +y the ecliptic pole
    // (TEME (0, -sin ε, cos ε) → world (0, cos ε, sin ε)), +z = x × y.
    const eps = (23.439 - 0.0000004 * (jd - JULIAN_DATE_J2000)) * (Math.PI / 180)
    _x.copy(center).negate().normalize()
    _y.set(0, Math.cos(eps), Math.sin(eps))
    _y.addScaledVector(_x, -_y.dot(_x)).normalize()
    _z.crossVectors(_x, _y)
    uniforms.uMoonBasis.value.setFromMatrix4(_basis.makeBasis(_x, _y, _z))
  })

  // Uniforms go in through the constructor, which keeps this object by
  // reference: R3F 9 copies a `uniforms` prop into new uniform objects, so
  // later writes to ours would never reach the GPU (the black Earth, 2026-10-28).
  // Memoized: R3F rebuilds the material whenever `args` changes identity.
  const materialArgs = useMemo<[THREE.ShaderMaterialParameters]>(() => [{ uniforms }], [uniforms])

  // The vertex shader places the Moon from the drawing camera, so the mesh's
  // own transform stays at the origin and culling is off.
  return (
    <mesh frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[1, 48, 24]} />
      <shaderMaterial vertexShader={moonVert} fragmentShader={moonFrag} args={materialArgs} />
    </mesh>
  )
})
