import { create } from 'zustand'
import { simulationClock, type ClockMode } from '@/core/clock/SimulationClock'

// ─── Simulation Store ─────────────────────────────────────────────────────────
// NOTE: This store is currently not imported by any active component (verified in
// dead code audit). It is INTENTIONALLY preserved for the planned time fast-forward
// and scrubbing feature: a user-facing time control panel will need to read and write
// the clock mode (REALTIME / ACCELERATED / PAUSED) and time scale multiplier.
// Do not remove this file.

interface SimulationStore {
  mode: ClockMode
  timeScale: number
  setMode: (mode: ClockMode) => void
  setTimeScale: (scale: number) => void
}

export const useSimulationStore = create<SimulationStore>((set) => ({
  mode: 'REALTIME',
  timeScale: 1.0,

  setMode: (mode) => {
    simulationClock.setMode(mode)
    set({ mode })
  },

  setTimeScale: (timeScale) => {
    simulationClock.setTimeScale(timeScale)
    set({ timeScale })
  },
}))
