import React, { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { useSettingsStore } from '@/stores/settingsStore'
import { FRAME_PRIORITY } from '../framePriority'
import { MultisampleRenderPass } from './MultisampleRenderPass'
import { SunFlare } from './SunFlare'

// ─── Bloom calibration ────────────────────────────────────────────────────────
// Threshold sits well above the atmosphere limb and the ISS PBR highlights
// (a low threshold made the limb smear into cloudy circles at planetary
// zoom) while the sun core (~4.3) and city-light cores still bloom.
// All tuning constants live here.
const BLOOM_STRENGTH = 0.26
const BLOOM_RADIUS = 0.4
const BLOOM_THRESHOLD = 2.4

// The composer bypasses the Canvas's antialiased backbuffer, so the scene
// pass carries its own MSAA (WebGL2) — that pass only; the composer's
// targets are single-sample (MultisampleRenderPass). Bloom off never uses
// this path.
const COMPOSER_MSAA_SAMPLES = 4

/**
 * Postprocessing — HDR bloom + OutputPass compositing.
 *
 * Render contract: the priority-1 useFrame takes over final rendering from
 * R3F. ISSGroup advances the station at priority −2, drei's CameraControls
 * runs at −1 and the other scene useFrames at 0 (framePriority.ts), so by the
 * time the composer renders, every transform this
 * frame is current — the same ordering the direct pipeline relied on.
 * OutputPass applies ACES tone mapping + sRGB (since r152, materials render
 * linear into the composer's target), so the custom shaders' tonemapping
 * includes keep behaving exactly as before. The scene pass is multisampled
 * (COMPOSER_MSAA_SAMPLES), since it bypasses the Canvas's antialiased
 * backbuffer; the passes after it are full-screen quads and run single-sample.
 */
export const Postprocessing = React.memo(function Postprocessing(): null {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  // Changes when the DPR governor calls setDpr; the composer must follow.
  const dpr = useThree((state) => state.viewport.dpr)

  const composerRef = useRef<EffectComposer | null>(null)
  const flareRef = useRef<SunFlare | null>(null)

  const lensFlare = useSettingsStore((state) => state.lensFlare)

  useEffect(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
    target.texture.name = 'EffectComposer.rt1'
    const composer = new EffectComposer(gl, target)
    const scenePass = new MultisampleRenderPass(scene, camera, COMPOSER_MSAA_SAMPLES)
    composer.addPass(scenePass)

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    )
    composer.addPass(bloom)

    // Flare sits after bloom (so its ghosts stay crisp rather than being
    // re-blurred) and before OutputPass (so it is tone-mapped with everything
    // else). Seeded from the store here, not only in the subscription below —
    // a rebuilt composer must not silently come back with the flare off.
    const flare = new SunFlare()
    flare.pass.enabled = useSettingsStore.getState().lensFlare
    composer.addPass(flare.pass)

    const outputPass = new OutputPass()
    composer.addPass(outputPass)

    composer.setSize(size.width, size.height)
    composer.setPixelRatio(gl.getPixelRatio())

    composerRef.current = composer
    flareRef.current = flare

    return () => {
      // EffectComposer.dispose frees only its own ping-pong targets and copy
      // pass; each pass owns GPU targets/materials (bloom: 11 HalfFloat mips)
      // that would otherwise leak on every Bloom toggle.
      scenePass.dispose()
      bloom.dispose()
      flare.pass.dispose()
      outputPass.dispose()
      composer.dispose()
      composerRef.current = null
      flareRef.current = null
    }
    // `size` is intentionally excluded — the sync effect below keeps a built
    // composer resized without rebuilding the pass chain on every resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera])

  // Keep composer resolution in lockstep with the viewport (and re-sync after
  // a rebuild, since this effect also runs on mount).
  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return
    // composer.setSize resizes every pass, bloom included.
    composer.setSize(size.width, size.height)
    composer.setPixelRatio(gl.getPixelRatio())
  }, [size, dpr, gl])

  // Enable/disable the flare without rebuilding the composer — a disabled
  // ShaderPass is skipped outright by the composer's render loop, so the off
  // state costs nothing.
  useEffect(() => {
    const flare = flareRef.current
    if (flare) flare.pass.enabled = lensFlare
  }, [lensFlare])

  useFrame(() => {
    const composer = composerRef.current
    if (!composer) return
    const flare = flareRef.current
    if (flare?.pass.enabled) {
      flare.update(camera as THREE.PerspectiveCamera, sunDirectionWorld(simulationClock.now().julianDate))
    }
    composer.render()
  }, FRAME_PRIORITY.composer)

  return null
})

/**
 * Gate — isolates the settings subscription so the toggle unmounts the whole
 * composer (and its priority-1 useFrame) without re-rendering SceneRoot.
 * With the toggle off, NOTHING replaces the direct pipeline: R3F renders
 * with per-material ACES exactly as before the composer existed.
 */
export const PostprocessingGate = React.memo(function PostprocessingGate(): JSX.Element | null {
  const postprocessing = useSettingsStore((state) => state.postprocessing)
  return postprocessing ? <Postprocessing /> : null
})
