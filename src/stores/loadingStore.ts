import { create } from 'zustand'

interface LoadingStore {
  prewarmingComplete: boolean
  setPrewarmingComplete: (complete: boolean) => void
  issDetailStatus: 'idle' | 'loading' | 'preparing' | 'ready' | 'failed'
  requestISSDetail: () => void
}

export const useLoadingStore = create<LoadingStore>((set) => ({
  prewarmingComplete: true,
  setPrewarmingComplete: (prewarmingComplete) => set({ prewarmingComplete }),
  issDetailStatus: 'idle',
  requestISSDetail: () => set((state) => (
    state.issDetailStatus === 'idle' || state.issDetailStatus === 'failed'
      ? { issDetailStatus: 'loading' }
      : state
  )),
}))
