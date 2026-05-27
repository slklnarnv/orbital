import { create } from 'zustand'
import { simulationClock, type ClockMode } from '@/core/clock/SimulationClock'

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
