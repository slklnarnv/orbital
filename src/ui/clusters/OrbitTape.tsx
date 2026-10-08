import { useEffect, useRef } from 'react'
import { simulationClock } from '@/core/clock/SimulationClock'
import { useSimulationStore } from '@/stores/simulationStore'
import { useOrbitalState } from '@/hooks/useOrbitalState'
import { formatPeriod, formatUtcClockParts } from '@/utils/formatters'
import { periodMsOf } from '@/utils/orbitalTime'

/**
 * OrbitTape — the console's signature instrument: one full ISS revolution
 * (ascending node -> ascending node) drawn as a ruler along the bottom edge
 * of the frame, with the station's position sweeping it at the SIMULATION's
 * rate, and a scrub surface for the time control.
 *
 * The phase is the argument of latitude, recovered each second from live
 * geodetic latitude:
 *
 *     sin(u) = sin(lat) / sin(inclination)
 *
 * Latitude alone pins u to within a half-turn, so the latitude trend
 * (northbound vs southbound between 1 Hz samples) resolves the quadrant:
 * northbound maps to u in [0, 90) U [270, 360), southbound to (90, 270).
 *
 * Display: the 1 Hz measurements only SET a target phase; a frame loop
 * sweeps the marker continuously at the clock's current rate (0 while
 * paused, timeScale while accelerated, wall rate when live — the sweep is
 * per-frame, so accelerated rates do not step at the 10 Hz tick) and eases
 * it toward the measurement (proportional glide). A jump larger than a
 * fifth of a turn — a seek — snaps instead of gliding.
 *
 * Scrub: pointer drag maps accumulated pointer travel (each move's shortest
 * arc, so a drag across the tape's 0/360 edge stays continuous) to an epoch
 * offset from the epoch captured at drag start — edge-to-edge drag = one
 * full orbital period — and seeks continuously. Scrubbing is a seek
 * interaction, so it first detaches from
 * any running rate into PAUSED (a seek under REALTIME would be re-pinned
 * to the wall within 100 ms, and under ACCELERATED time would run under
 * the pointer mid-drag); on release time stays paused. Play restores the
 * pre-scrub mode: from an accelerated preset it runs on from the scrubbed
 * epoch, from Live it re-pins to the wall (simulationStore resume point).
 * Arrow keys nudge ±1 min, PageUp/Down
 * ±10 min.
 */

const NODE_PHASES: Array<{ phase: number; label: string; node: boolean }> = [
  { phase: 0, label: 'asc node', node: true },
  { phase: 0.25, label: 'max N', node: false },
  { phase: 0.5, label: 'desc node', node: true },
  { phase: 0.75, label: 'max S', node: false },
]

/** Marker glide limit (phase fraction per second) toward the measured phase. */
const MAX_CORRECTION_PER_SECOND = 0.05
/** Slowest correction rate — guarantees the marker reaches the measurement. */
const MIN_CORRECTION_PER_SECOND = 0.0002
/** Proportional gain of the ease-out glide toward the measured phase. */
const GLIDE_GAIN = 0.5
/** Trail fades in only once the marker has settled onto the measurement. */
const TRAIL_SETTLED_DELTA = 0.002
/** Beyond this phase distance a target update is a seek — snap, don't glide. */
const SNAP_DELTA = 0.2
/** Keyboard scrub steps, in milliseconds of simulation time. */
const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -60_000,
  ArrowRight: 60_000,
  PageDown: -600_000,
  PageUp: 600_000,
}

/** Maps a pointer X within the tape rect to a phase in [0, 1). */
function phaseFromClientX(rect: DOMRect, clientX: number): number {
  const frac = (clientX - rect.left) / Math.max(1, rect.width)
  return Math.min(1, Math.max(0, frac))
}

export function OrbitTape(): JSX.Element {
  const { latitude, inclination, orbitalPeriod } = useOrbitalState()

  // Refs written during render (1 Hz telemetry throttles trigger renders) and
  // by the frame loop below. The app deliberately runs without StrictMode.
  const prevLatitudeRef = useRef<number | null>(null)
  const phaseRef = useRef<number | null>(0)
  const targetRef = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const trailRef = useRef<HTMLDivElement>(null)
  /** Whole-second stamp of the last ARIA write (see the frame loop). */
  const lastAriaSecondRef = useRef(-1)

  // Scrub state — refs, not React state: pointermove must not re-render.
  const scrubbingRef = useRef(false)
  const scrubPhaseRef = useRef(0)
  const scrubBaseRef = useRef<{
    epochMs: number
    prevPhase: number
    rect: DOMRect
  } | null>(null)
  const scrubAccumRef = useRef(0)

  const sinInc = Math.sin((inclination * Math.PI) / 180)
  if (Math.abs(sinInc) > 1e-6) {
    const sinLat = Math.sin((latitude * Math.PI) / 180)
    const clamped = Math.max(-1, Math.min(1, sinLat / sinInc))
    const ascending = (Math.asin(clamped) * 180) / Math.PI // [-90, 90]

    const prevLatitude = prevLatitudeRef.current
    let u: number
    if (prevLatitude === null) {
      // No trend yet: first sample. Northern half as the interim estimate —
      // the glide corrects it once the trend resolves.
      u = latitude >= 0 ? ascending : 180 - ascending
    } else if (latitude >= prevLatitude) {
      // Northbound: u in [0,90) climbing, or [270,360) after the south apex
      u = ascending >= 0 ? ascending : 360 + ascending
    } else {
      // Southbound: u in (90,270]
      u = 180 - ascending
    }
    prevLatitudeRef.current = latitude

    const target = u / 360
    if (targetRef.current === null) {
      targetRef.current = target
    } else {
      // Shortest-path target update so the glide never cuts across the
      // 0/360 wrap and trend noise at the apex latitudes cannot yank it.
      let delta = target - targetRef.current
      delta = ((delta + 1.5) % 1) - 0.5
      targetRef.current = (targetRef.current + delta + 1) % 1
    }
  }

  // Frame loop: continuous sweep at the simulation's rate, easing toward the
  // measured phase. Writes marker positions straight to the DOM; React
  // renders happen at 1 Hz and never position the marker themselves.
  useEffect(() => {
    let raf = 0
    let lastMs = performance.now()
    const periodMs = periodMsOf(orbitalPeriod)
    // Trail visibility with hysteresis: shown once the marker settles, hidden
    // only on a clear departure (opening glide, post-seek). A single threshold
    // flickered at high rates, where 1 Hz measurement jitter straddles it.
    let trailVisible = false
    const tick = (nowMs: number) => {
      const frameDtSec = Math.min(0.5, (nowMs - lastMs) / 1000)
      lastMs = nowMs
      const phase = phaseRef.current
      if (phase !== null) {
        let next: number
        let delta = 0
        let settledDelta = TRAIL_SETTLED_DELTA

        if (scrubbingRef.current) {
          // The pointer owns the marker for the duration of the drag.
          next = scrubPhaseRef.current
        } else {
          // Sweep at the simulation's own rate — 0 while paused, timeScale
          // while accelerated, wall rate when live — so the marker tracks
          // the mission clock instead of the wall clock.
          const mode = simulationClock.mode
          const rateFactor =
            mode === 'PAUSED' ? 0 : mode === 'ACCELERATED' ? simulationClock.timeScale : 1
          const sweepPerSec = rateFactor / (periodMs / 1000)
          const sweep = frameDtSec * sweepPerSec
          next = (phase + sweep) % 1
          // Measurements trail the clock by up to one 10 Hz telemetry step,
          // so the residual scales with rate: at 300× it is ~0.005 rev,
          // beyond the fixed floor, and the trail would flicker off.
          settledDelta = Math.max(TRAIL_SETTLED_DELTA, sweepPerSec * 0.2)

          // The measurement lands at 1 Hz but the station keeps moving: carry
          // the target forward at the same sweep rate so the glide only trims
          // residual drift. Without this the marker was pulled back toward a
          // measurement up to a second old — ~0.054 rev at 300×, beyond the
          // correction cap, so it lagged tens of degrees and snapped.
          if (targetRef.current !== null) targetRef.current = (targetRef.current + sweep) % 1
          const target = targetRef.current
          if (target !== null) {
            delta = ((target - next + 1.5) % 1) - 0.5
            if (Math.abs(delta) > SNAP_DELTA) {
              // Seek-sized jump: snap to the measured truth instead of
              // gliding for seconds.
              next = target
            } else {
              const rate = Math.min(
                MAX_CORRECTION_PER_SECOND,
                Math.max(MIN_CORRECTION_PER_SECOND, Math.abs(delta) * GLIDE_GAIN),
              )
              const step = Math.sign(delta) * Math.min(rate * frameDtSec, Math.abs(delta))
              next = (next + step + 1) % 1
            }
          }
        }

        phaseRef.current = next
        if (dotRef.current) dotRef.current.style.left = `${next * 100}%`
        if (trailRef.current) {
          // The trail reads as the path BEHIND the marker, so it only makes
          // sense once the marker has settled onto the measurement — during
          // the opening glide it stays hidden.
          trailRef.current.style.left = `calc(${next * 100}% - 28px)`
          const absDelta = Math.abs(delta)
          if (absDelta < settledDelta) trailVisible = true
          else if (absDelta > settledDelta * 4) trailVisible = false
          trailRef.current.style.opacity = trailVisible ? '1' : '0'
        }
        // ARIA is refreshed at most once a second. It is read by assistive
        // tech, not the compositor; the per-frame version formatted a Date and
        // built a string 60×/s, forever, for a value that can only change by
        // one second per second.
        const epochMs = simulationClock.now().epochMs
        const wholeSecond = Math.floor(epochMs / 1000)
        if (wholeSecond !== lastAriaSecondRef.current) {
          lastAriaSecondRef.current = wholeSecond
          const root = rootRef.current
          if (root) {
            root.setAttribute('aria-valuenow', next.toFixed(3))
            root.setAttribute('aria-valuetext', `${formatUtcClockParts(epochMs).time} UTC`)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [orbitalPeriod])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!event.isPrimary) return
    const store = useSimulationStore.getState()
    // Detach from any running rate before the first scrub seek (see header).
    if (store.mode !== 'PAUSED') store.togglePause()
    const rect = event.currentTarget.getBoundingClientRect()
    const phase = phaseFromClientX(rect, event.clientX)
    scrubBaseRef.current = { epochMs: simulationClock.now().epochMs, prevPhase: phase, rect }
    scrubAccumRef.current = 0
    scrubbingRef.current = true
    scrubPhaseRef.current = phase
    targetRef.current = phase
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is an optimization (keep moves flowing outside the strip);
      // scrubbing works without it. Synthetic/programmatic pointers have
      // no capturable id and throw here.
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const base = scrubBaseRef.current
    // A second finger landing mid-scrub must not hijack the drag.
    if (!event.isPrimary || !scrubbingRef.current || base === null) return
    const phase = phaseFromClientX(base.rect, event.clientX)
    scrubPhaseRef.current = phase
    // Unwrapped epoch offset: accumulate each move's shortest arc instead of
    // wrapping the total to ±half a turn. A wrapped total folds at the
    // half-tape point — dragging clean across the tape would seek a FULL
    // orbit away (the ISS lands one period later, near-identical, while
    // Earth's GMST visibly jumps) — where the accumulated delta moves time
    // monotonically, edge-to-edge = exactly one revolution.
    const step = ((phase - base.prevPhase + 1.5) % 1) - 0.5
    base.prevPhase = phase
    scrubAccumRef.current += step
    useSimulationStore.getState().seek(base.epochMs + scrubAccumRef.current * periodMsOf(orbitalPeriod))
  }

  const endScrub = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!event.isPrimary || !scrubbingRef.current) return
    scrubbingRef.current = false
    scrubBaseRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const stepMs = KEY_STEPS[event.key]
    if (stepMs === undefined) return
    event.preventDefault()
    useSimulationStore.getState().seek(simulationClock.now().epochMs + stepMs)
  }

  return (
    <div
      ref={rootRef}
      className="hud-tape"
      role="slider"
      aria-label="Orbit tape — drag to scrub time"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={0}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onKeyDown={onKeyDown}
    >
      <div className="hud-tape__line" />

      {NODE_PHASES.map(({ phase: p, label, node }) => (
        <div key={label}>
          <div
            className={`hud-tape__tick${node ? ' hud-tape__tick--node' : ''}`}
            style={{ left: `${p * 100}%` }}
          />
          <span
            className={`hud-tape__label${p === 0 ? ' hud-tape__label--start' : ''}`}
            style={{ left: `${p * 100}%` }}
          >
            {label}
          </span>
        </div>
      ))}

      <span className="hud-tape__period">{`one revolution · ${formatPeriod(orbitalPeriod)}`}</span>

      {/* Station marker with a short trail — positioned by the frame loop
          above (the initial styles are constants so React never fights the
          frame loop over the position). The marker is visible from the first
          frame at the ascending node and eases onto the measured phase. */}
      <div ref={trailRef} className="hud-tape__trail" style={{ left: '0%', opacity: 0 }} />
      <div ref={dotRef} className="hud-tape__dot" style={{ left: '0%', opacity: 1 }} />
    </div>
  )
}
