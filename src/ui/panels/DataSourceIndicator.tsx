import { useTelemetryStore } from '@/stores/telemetryStore'
import { useShallow } from 'zustand/react/shallow'
import { GlassPanel } from '../common/GlassPanel'
import { MonoValue } from '../common/MonoValue'
import type { TelemetryMode } from '@/types/orbital'

/**
 * DataSourceIndicator provides detailed TLE data link diagnostics.
 * Implements restrained color highlights matching the NASA/JPL/ESA styling rules.
 *
 * Store-1 FIX: Subscribes only to the 3 fields actually rendered here.
 * The previous useOrbitalState() subscription included latitude/longitude/speed/altitude,
 * which are updated by the 1 Hz throttle but were never used by this component,
 * causing up to 9 unnecessary re-renders per second.
 */
export function DataSourceIndicator(): JSX.Element {
  const telemetry = useTelemetryStore(
    useShallow((state) => ({
      mode: state.mode as TelemetryMode,
      confidence: state.confidence,
      tleAgeHours: state.tleAgeHours,
    }))
  )

  // Dynamic color coding for telemetry modes
  const modeColorClass =
    telemetry.mode === 'LIVE'
      ? 'text-emerald-400'
      : telemetry.mode === 'HYBRID'
        ? 'text-amber-400'
        : telemetry.mode === 'RECOVERY'
          ? 'text-sky-400'
          : 'text-rose-400'

  const dotColorClass =
    telemetry.mode === 'LIVE'
      ? 'bg-emerald-500 shadow-emerald-500/20'
      : telemetry.mode === 'HYBRID'
        ? 'bg-amber-500 shadow-amber-500/20'
        : telemetry.mode === 'RECOVERY'
          ? 'bg-sky-500 shadow-sky-500/20'
          : 'bg-rose-500 shadow-rose-500/20'

  return (
    <GlassPanel className="w-80 flex flex-col gap-3">
      <div>
        <h2 className="text-[10px] font-sans font-bold tracking-widest text-[var(--color-text-secondary)] uppercase opacity-75">
          Telemetry Link
        </h2>
      </div>

      <div className="h-px bg-white/5" />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs py-0.5">
          <span className="text-[var(--color-text-secondary)] font-sans select-none">
            Data Link Status
          </span>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${dotColorClass} animate-pulse`} />
            <span className={`font-mono font-bold uppercase tracking-wider ${modeColorClass}`}>
              {telemetry.mode}
            </span>
          </div>
        </div>

        <MonoValue
          label="Confidence Index"
          value={(telemetry.confidence * 100).toFixed(0)}
          unit="%"
        />

        <MonoValue
          label="Data Stream Age"
          value={telemetry.tleAgeHours < Infinity ? telemetry.tleAgeHours.toFixed(1) : 'N/A'}
          unit="h"
        />
      </div>
    </GlassPanel>
  )
}

