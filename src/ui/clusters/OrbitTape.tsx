import { useRef } from 'react'
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
 * Successive values are smoothed with wrap-around so the dot never jumps
 * across the node or jitter-oscillates near the apex latitudes.
 */

const NODE_PHASES: Array<{ phase: number; label: string; node: boolean }> = [
  { phase: 0, label: 'asc node', node: true },
  { phase: 0.25, label: 'max N', node: false },
  { phase: 0.5, label: 'desc node', node: true },
  { phase: 0.75, label: 'max S', node: false },
]

export function OrbitTape(): JSX.Element {
  const { latitude, inclination, orbitalPeriod } = useOrbitalState()

  // Refs written during render: phase advances strictly with the 1 Hz
  // telemetry throttles that trigger this render, so no effect churn is
  // needed. The app deliberately runs without StrictMode (see main.tsx).
  const prevLatitudeRef = useRef<number | null>(null)
  const phaseRef = useRef<number | null>(null)

  const sinInc = Math.sin((inclination * Math.PI) / 180)
  if (Math.abs(sinInc) > 1e-6) {
    const sinLat = Math.sin((latitude * Math.PI) / 180)
    const clamped = Math.max(-1, Math.min(1, sinLat / sinInc))
    const ascending = (Math.asin(clamped) * 180) / Math.PI // [-90, 90]

    const prevLatitude = prevLatitudeRef.current
    let u: number
    if (prevLatitude === null) {
      // No trend yet: first sample. Northern half as the interim estimate.
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
    if (phaseRef.current === null) {
      phaseRef.current = target
    } else {
      // Shortest-path angular smoothing keeps the dot continuous across the
      // 0/360 wrap and damps trend noise at the apex latitudes.
      let delta = target - phaseRef.current
      delta = ((delta + 1.5) % 1) - 0.5
      phaseRef.current = (phaseRef.current + delta * 0.4 + 1) % 1
    }
  }

  const phase = phaseRef.current

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

      {/* Station marker with a short trail — reads as motion along the tape */}
      {phase !== null && (
        <div
          className="hud-tape__trail"
          style={{ left: `calc(${phase * 100}% - 28px)` }}
        />
      )}
      {phase !== null && (
        <div className="hud-tape__dot" style={{ left: `${phase * 100}%` }} />
      )}
    </div>
  )
}
