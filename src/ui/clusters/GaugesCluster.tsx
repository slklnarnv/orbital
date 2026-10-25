import { useShallow } from 'zustand/react/shallow'
import { useOrbitalState } from '@/hooks/useOrbitalState'
import { useTelemetryStore } from '@/stores/telemetryStore'
import { formatCountdown } from '@/utils/formatters'
import { HudGauge } from '../common/HudGauge'

function eclipseLine(sunlit: boolean | null, inMs: number | null): string {
  if (sunlit === null) return '—'
  if (inMs === null) return sunlit ? 'Daylight · no eclipse this orbit' : 'Eclipse'
  return sunlit
    ? `Daylight · sunset in ${formatCountdown(inMs)}`
    : `Eclipse · sunrise in ${formatCountdown(inMs)}`
}

/**
 * GaugesCluster — bottom-left pair of bare numeral instruments carrying the
 * two numbers a viewer reads first: how fast, how high. Underlined by their
 * protractor tick-arcs, no bezels. A fine line beneath reads the next
 * sunset or sunrise the station will see.
 */
export function GaugesCluster(): JSX.Element {
  const { altitude, speed } = useOrbitalState()
  const { sunlit, shadowTransitionInMs } = useTelemetryStore(
    useShallow((state) => ({
      sunlit: state.sunlit,
      shadowTransitionInMs: state.shadowTransitionInMs,
    })),
  )
  const eclipseText = eclipseLine(sunlit, shadowTransitionInMs)

  return (
    <div className="hud-bottom-left hud-text">
      {/* columnGap: 'inherit' keeps .hud-bottom-left's gap (20px, 10px on mobile); inline px would beat the media query. */}
      <div style={{ display: 'flex', flexDirection: 'column', rowGap: 6, columnGap: 'inherit' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', columnGap: 'inherit' }}>
          <HudGauge label="Speed" value={speed.toFixed(2)} unit="km/s" width={96} />
          <HudGauge label="Altitude" value={altitude.toFixed(1)} unit="km" width={96} />
        </div>
        <span className="hud-fine" style={{ color: 'var(--hud-lo)', whiteSpace: 'nowrap' }}>
          {eclipseText}
        </span>
      </div>
    </div>
  )
}
