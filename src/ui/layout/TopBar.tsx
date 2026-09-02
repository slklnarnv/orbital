import { useSimulationClock } from '@/hooks/useSimulationClock'
import { useTelemetryStore } from '@/stores/telemetryStore'
import { useShallow } from 'zustand/react/shallow'
import { formatJulianDate, formatGmst } from '@/utils/formatters'
import { telemetryModeVisual } from '../common/telemetryModeVisual'

/**
 * TopBar — two floating corner clusters, no bar between them.
 * Left: identity and the data-link state. Right: the orbital-elements line
 * (inclination, Julian date, GMST) in fine mono.
 */
export function TopBar(): JSX.Element {
  // 1 Hz subscription — the clocks in this component never read faster
  const simTime = useSimulationClock(1000)

  const { mode, confidence, tleAgeHours, inclination } = useTelemetryStore(
    useShallow((state) => ({
      mode: state.mode,
      confidence: state.confidence,
      tleAgeHours: state.tleAgeHours,
      inclination: state.inclination,
    }))
  )

  const modeVisual = telemetryModeVisual(mode)
  const modeName = mode.charAt(0) + mode.slice(1).toLowerCase()

  return (
    <>
      <div className="hud-corner hud-corner--tl hud-text">
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.24em',
            color: 'var(--hud-hi)',
          }}
        >
          ORBITAL
        </span>

        <span aria-hidden="true" style={{ width: 1, height: 12, background: 'var(--hud-line)' }} />

        <span
          className="hud-label"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: modeVisual.color }}
        >
          <span aria-hidden="true" className={`hud-dot ${modeVisual.dotClass}`} />
          {modeName}
        </span>

        <span className="hud-fine hud-corner__meta" style={{ color: 'var(--hud-lo)' }}>
          {tleAgeHours < Infinity ? `TLE age ${tleAgeHours.toFixed(1)}h` : 'TLE age —'}
          {' · '}
          confidence {(confidence * 100).toFixed(0)}%
        </span>
      </div>

      <div className="hud-corner hud-corner--tr hud-text">
        <span className="hud-fine" style={{ fontSize: 9.5 }}>
          INC {inclination.toFixed(2)}°
          <span style={{ color: 'var(--hud-lo)' }}>{'  ·  '}</span>
          JD {formatJulianDate(simTime.julianDate)}
          <span style={{ color: 'var(--hud-lo)' }}>{'  ·  '}</span>
          GMST {formatGmst(simTime.gmst)}
        </span>
      </div>
    </>
  )
}
