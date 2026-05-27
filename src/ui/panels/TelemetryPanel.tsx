import { useOrbitalState } from '@/hooks/useOrbitalState'
import { GlassPanel } from '../common/GlassPanel'
import { MonoValue } from '../common/MonoValue'
import {
  formatLatitude,
  formatLongitude,
  formatKilometers,
  formatKilometersPerSecond,
  formatPeriod
} from '@/utils/formatters'

/**
 * TelemetryPanel displays geodetic and dynamic orbital stats in real-time.
 * Strictly formatted, clean spacing rhythm.
 */
export function TelemetryPanel(): JSX.Element {
  // Subscribe to the 1Hz throttled orbital/telemetry state
  const telemetry = useOrbitalState()

  return (
    <GlassPanel className="w-80 flex flex-col gap-3">
      <div>
        <h2 className="text-[10px] font-sans font-bold tracking-widest text-[var(--color-text-secondary)] uppercase opacity-75">
          Orbital Telemetry
        </h2>
      </div>

      <div className="h-px bg-white/5" />

      <div className="flex flex-col gap-1.5">
        <MonoValue
          label="Geodetic Latitude"
          value={formatLatitude(telemetry.latitude)}
        />
        <MonoValue
          label="Geodetic Longitude"
          value={formatLongitude(telemetry.longitude)}
        />
        <MonoValue
          label="Ellipsoidal Altitude"
          value={formatKilometers(telemetry.altitude)}
        />
        <MonoValue
          label="Orbital Velocity"
          value={formatKilometersPerSecond(telemetry.speed)}
        />
        <MonoValue
          label="Orbital Period"
          value={formatPeriod(telemetry.orbitalPeriod)}
        />
        <MonoValue
          label="Orbital Inclination"
          value={`${telemetry.inclination.toFixed(2)}°`}
        />
      </div>
    </GlassPanel>
  )
}
