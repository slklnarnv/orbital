import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useBootStore } from '@/stores/bootStore'
import { useTelemetryStore } from '@/stores/telemetryStore'
import { telemetryModeVisual } from '@/ui/common/telemetryModeVisual'

import { orbitPath } from './bootMark'
import { alignToBootShellClock } from './bootShell'
import { assetFraction, assetsSettled, stageLabel, type AssetSnapshot } from './bootProgress'

const ORBIT_D = orbitPath()
/** Hold the full bar briefly so the last stage reads "Ready" before the fade. */
const HOLD_MS = 400
/** Matches the .boot opacity transition. */
const FADE_MS = 800

type Phase = 'loading' | 'hold' | 'exit' | 'gone'

/**
 * Loading screen with staged, honest progress (plan 017 I2): the data link
 * (telemetry bootstrap), Earth (texture files) and station (model files).
 * Markup and classes match the static first-paint copy in index.html.
 *
 * The gate is assets only. The data link never blocks the scene: the station
 * propagates from the bundled TLE until live elements arrive, and the HUD
 * keeps showing the link state after this screen leaves.
 */
export function LoadingScreen(): JSX.Element | null {
  const liveAssets = useBootStore((state) => state.assets)
  const linkSettled = useBootStore((state) => state.linkSettled)
  const mode = useTelemetryStore((state) => state.mode)
  const [phase, setPhase] = useState<Phase>('loading')
  // Frozen at the gate so late loads (the deferred detail model) cannot pull
  // the bar back down while the screen fades.
  const [latched, setLatched] = useState<AssetSnapshot | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    alignToBootShellClock(rootRef.current)
  }, [])

  const settled = assetsSettled(liveAssets)
  useEffect(() => {
    if (phase !== 'loading' || !settled) return
    setLatched(liveAssets)
    setPhase('hold')
  }, [phase, settled, liveAssets])

  useEffect(() => {
    if (phase === 'hold') {
      const id = setTimeout(() => setPhase('exit'), HOLD_MS)
      return () => clearTimeout(id)
    }
    if (phase === 'exit') {
      const id = setTimeout(() => setPhase('gone'), FADE_MS)
      return () => clearTimeout(id)
    }
    return undefined
  }, [phase])

  if (phase === 'gone') return null

  const assets = latched ?? liveAssets
  const fraction = assetFraction(assets)
  const earth = stageLabel(assets.earth)
  const station = stageLabel(assets.station)
  const link = linkSettled ? telemetryModeVisual(mode) : null
  const linkLabel = link ? link.label : 'Connecting'

  return (
    <div
      ref={rootRef}
      className={phase === 'exit' ? 'boot boot--exit' : 'boot'}
      role="progressbar"
      aria-label="Loading"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuetext={`Data link ${linkLabel.toLowerCase()}, Earth ${earth.toLowerCase()}, station ${station.toLowerCase()}`}
    >
      <div className="boot-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <path className="boot-orbit" d={ORBIT_D} />
          <path className="boot-trail" d={ORBIT_D} pathLength={100} />
        </svg>
        <div className="boot-glint">
          <BootGlint />
        </div>
      </div>

      <dl className="boot-stages">
        <dt>Data link</dt>
        <dd className={link ? undefined : 'boot-pending'}>
          {link && <span className={`hud-dot ${link.dotClass}`} />}
          {linkLabel}
        </dd>
        <dt>Earth</dt>
        <dd className={earth === 'Ready' ? undefined : 'boot-pending'}>{earth}</dd>
        <dt>Station</dt>
        <dd className={station === 'Ready' ? undefined : 'boot-pending'}>{station}</dd>
      </dl>

      <div className="boot-bar" aria-hidden="true">
        <div className="boot-bar-fill" style={{ transform: `scaleX(${fraction})` }} />
      </div>
    </div>
  )
}

/** The station glint: halo, four-point sparkle and core, as in the icon. */
function BootGlint(): JSX.Element {
  return (
    <svg viewBox="-10 -10 20 20">
      <defs>
        <radialGradient id="boot-glint-halo">
          <stop offset="0" stopColor="#f1ede4" stopOpacity="0.36" />
          <stop offset="1" stopColor="#f1ede4" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r="9.6" fill="url(#boot-glint-halo)" />
      <path d="M0 -10L1.2 -1.2L10 0L1.2 1.2L0 10L-1.2 1.2L-10 0L-1.2 -1.2Z" fill="#f1ede4" />
      <circle r="3.2" fill="#f1ede4" />
    </svg>
  )
}
