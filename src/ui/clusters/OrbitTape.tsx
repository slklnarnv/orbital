import { useEffect, useRef } from 'react'
import { useOrbitalState } from '@/hooks/useOrbitalState'
import { formatPeriod } from '@/utils/formatters'

/**
 * OrbitTape — the console's signature instrument: one full ISS revolution
 * (ascending node -> ascending node) drawn as a ruler along the bottom edge
 * of the frame, with the station's position sweeping it in real time.
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
 * sweeps the marker continuously at the orbital rate and eases it toward
 * the measurement (proportional glide — fast catch-up that decelerates
 * smoothly). The marker is visible from the first frame at the ascending
 * node and glides onto the measured phase, so startup draws attention
 * without stepping; the trail fades in only once the marker has settled
 * (a trail while the marker still slides would point the wrong way).
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

export function OrbitTape(): JSX.Element {
  const { latitude, inclination, orbitalPeriod } = useOrbitalState()

  // Refs written during render (1 Hz telemetry throttles trigger renders) and
  // by the frame loop below. The app deliberately runs without StrictMode.
  const prevLatitudeRef = useRef<number | null>(null)
  const phaseRef = useRef<number | null>(0)
  const targetRef = useRef<number | null>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const trailRef = useRef<HTMLDivElement>(null)

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

  // Frame loop: continuous sweep at the orbital rate, easing toward the
  // measured phase. Writes marker positions straight to the DOM; React
  // renders happen at 1 Hz and never position the marker themselves.
  useEffect(() => {
    let raf = 0
    let lastMs = performance.now()
    const periodSec = Math.max(600, (orbitalPeriod || 92.9) * 60)
    const tick = (nowMs: number) => {
      const dtSec = Math.min(1, (nowMs - lastMs) / 1000)
      lastMs = nowMs
      const phase = phaseRef.current
      if (phase !== null) {
        let next = (phase + dtSec / periodSec) % 1
        const target = targetRef.current
        let delta = 0
        if (target !== null) {
          delta = ((target - next + 1.5) % 1) - 0.5
          const rate = Math.min(
            MAX_CORRECTION_PER_SECOND,
            Math.max(MIN_CORRECTION_PER_SECOND, Math.abs(delta) * GLIDE_GAIN),
          )
          const step = Math.sign(delta) * Math.min(rate * dtSec, Math.abs(delta))
          next = (next + step + 1) % 1
        }
        phaseRef.current = next
        if (dotRef.current) dotRef.current.style.left = `${next * 100}%`
        if (trailRef.current) {
          // The trail reads as the path BEHIND the marker, so it only makes
          // sense once the marker has settled onto the measurement — during
          // the opening glide it stays hidden.
          trailRef.current.style.left = `calc(${next * 100}% - 28px)`
          trailRef.current.style.opacity = Math.abs(delta) < TRAIL_SETTLED_DELTA ? '1' : '0'
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [orbitalPeriod])

  return (
    <div className="hud-tape" aria-hidden="true">
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
