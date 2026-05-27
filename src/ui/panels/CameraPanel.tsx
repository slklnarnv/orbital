import { useCameraStore } from '@/stores/cameraStore'
import { GlassPanel } from '../common/GlassPanel'
import { MonoValue } from '../common/MonoValue'

/**
 * CameraPanel provides detailed tracking diagnostics and camera actions.
 * Restrained premium style inspired by aerospace consoles.
 */
export function CameraPanel(): JSX.Element {
  const cameraMode = useCameraStore((state) => state.mode)
  const isTracking = useCameraStore((state) => state.isTracking)
  const zoomProgress = useCameraStore((state) => state.zoomProgress)
  const triggerLocateISS = useCameraStore((state) => state.triggerLocateISS)

  function handleLocateISS(): void {
    triggerLocateISS()
  }

  return (
    <GlassPanel className="w-80 flex flex-col gap-3">
      <div>
        <h2 className="text-[10px] font-sans font-bold tracking-widest text-[var(--color-text-secondary)] uppercase opacity-75">
          Camera Navigation
        </h2>
      </div>

      <div className="h-px bg-white/5" />

      <div className="flex flex-col gap-2">
        <MonoValue
          label="Operational Mode"
          value={cameraMode}
          highlight={isTracking}
        />

        <div className="flex justify-between items-baseline py-0.5 text-xs">
          <span className="text-[var(--color-text-secondary)] font-sans select-none">
            Tracking Lock
          </span>
          <span
            className={`
              font-mono font-bold tracking-wide text-xs
              ${isTracking ? 'text-[var(--color-success)]' : 'text-[var(--color-text-secondary)]/50'}
            `}
          >
            {isTracking ? 'LOCKED' : 'FREE'}
          </span>
        </div>

        {/* Zoom progress meter */}
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex justify-between text-[9px] font-mono text-[var(--color-text-secondary)] opacity-75 select-none">
            <span>ZOOM PROGRESS</span>
            <span>{(zoomProgress * 100).toFixed(0)}%</span>
          </div>
          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent)] transition-all duration-100 ease-out"
              style={{ width: `${zoomProgress * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="h-px bg-white/5" />

      {/* Programmatic Navigation Trigger */}
      <button
        id="btn-locate-iss"
        onClick={handleLocateISS}
        className="
          w-full py-2 px-3
          text-[10px] font-mono tracking-widest uppercase
          rounded-sm border border-[var(--color-accent)]/20
          text-[var(--color-accent)] bg-[var(--color-accent)]/5
          hover:bg-[var(--color-accent)]/10 hover:border-[var(--color-accent)]/40
          active:bg-[var(--color-accent)]/20
          transition-colors duration-150
          flex items-center justify-center gap-2
          cursor-pointer
          select-none
        "
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6" cy="6" r="2" fill="currentColor" />
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1" />
          <line x1="6" y1="0" x2="6" y2="3" stroke="currentColor" strokeWidth="1" />
          <line x1="6" y1="9" x2="6" y2="12" stroke="currentColor" strokeWidth="1" />
          <line x1="0" y1="6" x2="3" y2="6" stroke="currentColor" strokeWidth="1" />
          <line x1="9" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1" />
        </svg>
        <span>Locate Tracking Target</span>
      </button>
    </GlassPanel>
  )
}
