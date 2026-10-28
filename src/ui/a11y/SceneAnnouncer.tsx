import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCameraStore } from '@/stores/cameraStore'
import { useGeoStore } from '@/stores/geoStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { useTelemetryStore } from '@/stores/telemetryStore'
import { describeCameraMode, describeDaylightChange, describeScene } from './sceneSummary'

/** A camera mode must hold this long before it is announced (zooming crosses several). */
const MODE_SETTLE_MS = 1200

/** Id of the canvas description; the scene wrapper points at it. */
export const SCENE_SUMMARY_ID = 'scene-summary'

/**
 * The canvas in words, for screen readers: a visually hidden sentence the
 * scene wrapper uses as its description (`aria-describedby`). Not live — it
 * is read on demand, so it may follow the 1 Hz stores.
 */
export function SceneSummary(): JSX.Element {
  const facts = {
    ...useGeoStore(useShallow((state) => ({ placeName: state.placeName, continent: state.continent }))),
    ...useTelemetryStore(
      useShallow((state) => ({ sunlit: state.sunlit, shadowTransitionInMs: state.shadowTransitionInMs })),
    ),
    ...useSimulationStore(
      useShallow((state) => ({ accelerated: state.mode === 'ACCELERATED', timeScale: state.timeScale })),
    ),
  }
  return (
    <p id={SCENE_SUMMARY_ID} className="sr-only">
      {describeScene(facts)}
    </p>
  )
}

/**
 * The polite live region: announces a camera mode once it settles and the
 * station's sunrise and sunset. Flips are not announced while time runs
 * accelerated (at 300× they come every few seconds), and nothing is said at
 * load. Lives outside the HUD frame so `H` does not silence it.
 */
export function SceneAnnouncer(): JSX.Element {
  const [message, setMessage] = useState('')

  useEffect(() => {
    let announcedMode = useCameraStore.getState().mode
    let timer: ReturnType<typeof setTimeout> | null = null
    // The camera store also carries the per-frame zoom; only a mode or
    // flight change restarts the settle timer.
    const unsubscribeCamera = useCameraStore.subscribe((state, previous) => {
      if (state.mode === previous.mode && state.isTransitioning === previous.isTransitioning) return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        const { mode, isTransitioning } = useCameraStore.getState()
        if (isTransitioning || mode === announcedMode) return
        announcedMode = mode
        setMessage(describeCameraMode(mode))
      }, MODE_SETTLE_MS)
    })

    const unsubscribeSun = useTelemetryStore.subscribe((state, previous) => {
      if (state.sunlit === previous.sunlit || state.sunlit === null || previous.sunlit === null) return
      if (useSimulationStore.getState().mode === 'ACCELERATED') return
      setMessage(describeDaylightChange(state.sunlit))
    })

    return () => {
      if (timer !== null) clearTimeout(timer)
      unsubscribeCamera()
      unsubscribeSun()
    }
  }, [])

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  )
}
