import { useSimulationClock } from '@/hooks/useSimulationClock'
import { formatUtcClock, formatJulianDate, formatGmst } from '@/utils/formatters'

/**
 * TopBar represents the clean, unified aerospace header bar.
 * Mounts at the top of the viewport, delivering mission branding and high-accuracy flight clocks.
 */
export function TopBar(): JSX.Element {
  // Subscribe to clock ticks at 1000ms (1Hz) to throttle re-renders of UTC, JD, and GMST clock text
  const simTime = useSimulationClock(1000)

  return (
    <header
      className="
        absolute top-0 left-0 right-0 z-10
        h-12 w-full
        bg-slate-950/85
        backdrop-blur-md
        border-b border-white/5
        px-6
        flex items-center justify-between
        select-none
      "
    >
      {/* Left: Aerospace Brand & Logo */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-sans font-bold tracking-wider text-[var(--color-accent)] uppercase">
          Orbital
        </span>
        <div className="w-px h-3 bg-white/10" />
        <span className="text-[10px] font-mono tracking-widest text-[var(--color-text-secondary)] opacity-75 uppercase">
          Sys_St: NOMINAL
        </span>
      </div>

      {/* Center: Monospace Mission Clock */}
      <div className="flex items-center gap-6">
        <span className="font-mono text-xs font-semibold tracking-wider text-[var(--color-text-primary)]">
          {formatUtcClock(simTime.epochMs)}
        </span>
      </div>

      {/* Right: Greenwich Sidereal Rotation & Julian Date */}
      <div className="flex items-center gap-6 text-[10px] font-mono text-[var(--color-text-secondary)]">
        <div className="flex items-center gap-1.5">
          <span>JD:</span>
          <span className="text-[var(--color-text-primary)]">{formatJulianDate(simTime.julianDate)}</span>
        </div>
        <div className="w-px h-2.5 bg-white/10" />
        <div className="flex items-center gap-1.5">
          <span>GMST:</span>
          <span className="text-[var(--color-text-primary)]">{formatGmst(simTime.gmst)}</span>
        </div>
      </div>
    </header>
  )
}

