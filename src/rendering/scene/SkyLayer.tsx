import type { JSX } from 'react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { precessionJ2000ToDate } from '@/core/orbital/MoonEphemeris'
import { assetUrl } from '@/utils/assetUrl'
import { parseStarCatalog } from './starCatalog'
import {
  MILKY_WAY_OPACITY,
  STAR_BRIGHTNESS_CAP,
  STAR_MAG_SLOPE,
  STAR_SIZE_EXTRA_PX,
  STAR_SIZE_GROW_MAG,
  STAR_SIZE_GROW_RANGE,
  STAR_SIZE_MIN_PX,
  STAR_ZERO_MAG_BRIGHTNESS,
} from './skyConfig'
import starsVert from '../shaders/stars.vert'
import starsFrag from '../shaders/stars.frag'
import milkyWayVert from '../shaders/milkyWay.vert'
import milkyWayFrag from '../shaders/milkyWay.frag'

// The Milky Way panorama (NASA SVS Deep Star Maps, J2000 RA/Dec) blocks
// first paint as before; the star catalogue streams in after it.
const STARMAP_URL = assetUrl('/textures/starmap-4k.webp')
useTexture.preload(STARMAP_URL)
const STARS_URL = assetUrl('/textures/stars.bin')

/** Precession moves 50″ a year; refresh it when the clock has moved a day. */
const PRECESSION_REFRESH_DAYS = 1

/**
 * The night sky: the Milky Way panorama and the 9,096 stars of the Yale
 * Bright Star Catalogue at their true positions, magnitudes and colours.
 * Both are drawn from the camera's direction only, on the far plane, so they
 * sit at infinity (no parallax) and everything else hides them.
 */
export const SkyLayer = React.memo(function SkyLayer(): JSX.Element {
  const { gl } = useThree()
  const starmapTex = useTexture(STARMAP_URL)
  useEffect(() => {
    starmapTex.colorSpace = THREE.SRGBColorSpace
    starmapTex.minFilter = THREE.LinearMipmapLinearFilter
    starmapTex.magFilter = THREE.LinearFilter
    starmapTex.generateMipmaps = true
    starmapTex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    starmapTex.needsUpdate = true
  }, [starmapTex, gl])

  const [stars, setStars] = useState<THREE.BufferGeometry | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let geometry: THREE.BufferGeometry | null = null
    fetch(STARS_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`stars.bin: HTTP ${response.status}`)
        return response.arrayBuffer()
      })
      .then((buffer) => {
        const catalog = parseStarCatalog(buffer)
        geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(catalog.directions, 3, true))
        geometry.setAttribute('aMag', new THREE.BufferAttribute(catalog.magnitudes, 1))
        geometry.setAttribute('aColor', new THREE.BufferAttribute(catalog.colors, 3, true))
        setStars(geometry)
      })
      .catch((error: unknown) => {
        // No stars is a degraded sky, not a broken app: the panorama stays.
        if (!controller.signal.aborted) console.warn('[sky] star catalogue unavailable', error)
      })
    return () => {
      controller.abort()
      geometry?.dispose()
    }
  }, [])

  const precession = useRef({ jd: Number.NaN, matrix: new THREE.Matrix3(), inverse: new THREE.Matrix3() })
  const starUniforms = useMemo(() => ({
    uPrecession: { value: precession.current.matrix },
    uPixelRatio: { value: 1 },
    uZeroMagBrightness: { value: STAR_ZERO_MAG_BRIGHTNESS },
    uMagSlope: { value: STAR_MAG_SLOPE },
    uBrightnessCap: { value: STAR_BRIGHTNESS_CAP },
    uSizeMin: { value: STAR_SIZE_MIN_PX },
    uSizeExtra: { value: STAR_SIZE_EXTRA_PX },
    uSizeGrowMag: { value: STAR_SIZE_GROW_MAG },
    uSizeGrowRange: { value: STAR_SIZE_GROW_RANGE },
  }), [])
  const milkyWayUniforms = useMemo(() => ({
    uMap: { value: starmapTex },
    uPrecessionInverse: { value: precession.current.inverse },
    uOpacity: { value: MILKY_WAY_OPACITY },
  }), [starmapTex])

  useFrame(() => {
    const jd = simulationClock.now().julianDate
    const p = precession.current
    if (!(Math.abs(jd - p.jd) < PRECESSION_REFRESH_DAYS)) {
      const m = precessionJ2000ToDate(jd)
      p.matrix.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8])
      p.inverse.copy(p.matrix).transpose()
      p.jd = jd
    }
    starUniforms.uPixelRatio.value = gl.getPixelRatio()
  })

  // Uniforms go in through the constructor, which keeps these objects by
  // reference: R3F 9 copies a `uniforms` prop into new uniform objects, so
  // later writes to ours would never reach the GPU (the black Earth, 2026-10-28).
  // Memoized: R3F rebuilds the material whenever `args` changes identity.
  const starMaterialArgs = useMemo<[THREE.ShaderMaterialParameters]>(() => [{ uniforms: starUniforms }], [starUniforms])
  const materialArgs = useMemo<[THREE.ShaderMaterialParameters]>(() => [{ uniforms: milkyWayUniforms }], [milkyWayUniforms])

  return (
    <>
      {/* renderOrder 0: the deepest layer, blended over the black clear
          colour exactly as the old panorama sphere (opacity, no tone map). */}
      <mesh renderOrder={0} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[1, 32, 16]} />
        <shaderMaterial
          vertexShader={milkyWayVert}
          fragmentShader={milkyWayFrag}
          args={materialArgs}
          side={THREE.BackSide}
          transparent={true}
          depthWrite={false}
          blending={THREE.NormalBlending}
        />
      </mesh>

      {/* renderOrder 1: after the panorama, before the sun billboard (2),
          so the sun's additive glow always composites on top. */}
      {stars && (
        <points geometry={stars} renderOrder={1} frustumCulled={false} raycast={() => null}>
          <shaderMaterial
            vertexShader={starsVert}
            fragmentShader={starsFrag}
            args={starMaterialArgs}
            transparent={true}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      )}
    </>
  )
})
