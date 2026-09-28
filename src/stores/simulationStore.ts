import { create } from 'zustand'
import { simulationClock, type ClockMode } from '@/core/clock/SimulationClock'

// ─── Simulation Store ─────────────────────────────────────────────────────────
/**
 * The UI's single write path to the SimulationClock — the time-control
 * transport row (TimeControls.tsx), the orbit-tape scrub, and the Space
 * shortcut all route through here. Kept as a store (not bare clock calls)
 * so the mode/rate/resume semantics live in one testable place.
 *
 * Semantics:
 * - Live is REALTIME (wall-pinned); 1×/10×/60×/300× are ACCELERATED presets;
 *   PAUSED freezes. See TimeControls for the user-facing vocabulary.
 * - Seeks detach from Live first: REALTIME re-pins the epoch to the wall on
 *   the next tick, so a seek without switching to PAUSED would be undone
 *   within 100 ms. Pausing saves a resume point that Play restores.
 * - Seeks clamp to ±7 days of wall now (SGP4 sanity; the confidence readout
 *   already degrades with TLE age, but arbitrary-year jumps are garbage).
 */

/** How far from wall-clock time a seek may land. */
const MAX_SEEK_OFFSET_MS = 7 * 24 * 60 * 60 * 1000

interface SimulationStore {
  mode: ClockMode
  timeScale: number
  /** Mode to restore when leaving PAUSED via togglePause. */
  resumeMode: ClockMode
  /** Rate to restore when leaving PAUSED via togglePause. */
  resumeScale: number
  setMode: (mode: ClockMode) => void
  setTimeScale: (scale: number) => void
  /** Enter ACCELERATED at a preset rate (from any mode, including PAUSED). */
  setRate: (scale: number) => void
  /** Pause, or resume the mode/rate that was running before the pause. */
  togglePause: () => void
  /** Jump to an epoch; detaches from REALTIME into PAUSED first. */
  seek: (epochMs: number) => void
}

function clampSeek(epochMs: number): number {
  const wallNow = Date.now()
  return Math.max(wallNow - MAX_SEEK_OFFSET_MS, Math.min(epochMs, wallNow + MAX_SEEK_OFFSET_MS))
}

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  mode: 'REALTIME',
  timeScale: 1.0,
  resumeMode: 'REALTIME',
  resumeScale: 1.0,

  setMode: (mode) => {
    simulationClock.setMode(mode)
    set({ mode })
  },

  setTimeScale: (timeScale) => {
    simulationClock.setTimeScale(timeScale)
    set({ timeScale })
  },

  setRate: (scale) => {
    simulationClock.setTimeScale(scale)
    simulationClock.setMode('ACCELERATED')
    set({ mode: 'ACCELERATED', timeScale: scale })
  },

  togglePause: () => {
    const { mode, timeScale, resumeMode, resumeScale } = get()
    if (mode !== 'PAUSED') {
      simulationClock.setMode('PAUSED')
      set({ mode: 'PAUSED', resumeMode: mode, resumeScale: timeScale })
    } else {
      simulationClock.setTimeScale(resumeScale)
      simulationClock.setMode(resumeMode)
      set({ mode: resumeMode, timeScale: resumeScale })
    }
  },

  seek: (epochMs) => {
    const { mode, timeScale } = get()
    if (mode === 'REALTIME') {
      // Detach before seeking — REALTIME re-pins the epoch to the wall on
      // the next tick, which would silently discard the jump.
      simulationClock.setMode('PAUSED')
      set({ mode: 'PAUSED', resumeMode: 'REALTIME', resumeScale: timeScale })
    }
    simulationClock.seekTo(clampSeek(epochMs))
  },
}))
