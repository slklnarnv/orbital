import { useCameraStore } from '@/stores/cameraStore'

/** "PLANETARY" -> "Planetary" — enum values spoken in the console's voice. */
function sentenceCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase()
}

/**
 * CameraCluster — the frame's single control, parked in the top-right with
 * the systems (controls top, data bottom). The reticle flies the camera to
 * the station; mode, tracking state, and the zoom hairline read beside it.
 */
export function CameraCluster(): JSX.Element {
  const cameraMode = useCameraStore((state) => state.mode)
  const isTracking = useCameraStore((state) => state.isTracking)
  const zoomProgress = useCameraStore((state) => state.zoomProgress)
  const triggerLocateISS = useCameraStore((state) => state.triggerLocateISS)

  return (
    <div className="hud-camera hud-text">
      <button
        id="btn-locate-iss"
        type="button"
        onClick={() => triggerLocateISS()}
        aria-label="Locate ISS — fly the camera to the station"
        className="hud-btn-locate"
      >
        <span className="hud-reticle" style={{ width: 44, height: 44 }}>
          <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
            <path d="M2 15 V2 H15" strokeWidth={2} />
            <path d="M49 2 H62 V15" strokeWidth={2} />
            <path d="M62 49 V62 H49" strokeWidth={2} />
            <path d="M15 62 H2 V49" strokeWidth={2} />
          </svg>
          <svg
            aria-hidden="true"
            focusable="false"
            width="14"
            height="14"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ opacity: 0.92 }}
          >
            <circle cx="6" cy="6" r="1.8" fill="currentColor" />
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="0.8" />
            <line x1="6" y1="0" x2="6" y2="2.6" stroke="currentColor" strokeWidth="0.8" />
            <line x1="6" y1="9.4" x2="6" y2="12" stroke="currentColor" strokeWidth="0.8" />
            <line x1="0" y1="6" x2="2.6" y2="6" stroke="currentColor" strokeWidth="0.8" />
            <line x1="9.4" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="0.8" />
          </svg>
        </span>
      </button>

      <div className="hud-camera__state">
        <span className="hud-label">
          <span style={{ color: 'var(--hud-hi)' }}>{sentenceCase(cameraMode)}</span>
          <span style={{ color: 'var(--hud-lo)' }}>{`  ·  ${isTracking ? 'Locked' : 'Free'}`}</span>
        </span>
        <div
          className="hud-zoommeter"
          role="progressbar"
          aria-label="Zoom progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(zoomProgress * 100)}
        >
          <div className="hud-zoommeter__fill" style={{ width: `${zoomProgress * 100}%` }} />
        </div>
      </div>
    </div>
  )
}
