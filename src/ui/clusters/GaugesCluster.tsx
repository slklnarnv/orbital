import { useOrbitalState } from '@/hooks/useOrbitalState'
import { HudGauge } from '../common/HudGauge'

/**
 * GaugesCluster — bottom-left pair of bare numeral instruments carrying the
 * two numbers a viewer reads first: how fast, how high. Underlined by their
 * protractor tick-arcs, no bezels.
 */
export function GaugesCluster(): JSX.Element {
  const { altitude, speed } = useOrbitalState()

  return (
    <div className="hud-bottom-left hud-text">
      <HudGauge label="Speed" value={speed.toFixed(2)} unit="km/s" width={96} />
      <HudGauge label="Altitude" value={altitude.toFixed(1)} unit="km" width={96} />
    </div>
  )
}
