import { create } from 'zustand'

interface LoadingStore {
  prewarmingComplete: boolean
  setPrewarmingComplete: (complete: boolean) => void
}

export const useLoadingStore = create<LoadingStore>((set) => ({
  prewarmingComplete: true,
  setPrewarmingComplete: (prewarmingComplete) => set({ prewarmingComplete }),
}))
