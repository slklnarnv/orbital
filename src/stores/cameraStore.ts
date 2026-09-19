import { create } from 'zustand'
import { CameraMode, CameraTransitionState } from '@/types/camera'
import { useLoadingStore } from './loadingStore'

// ─── Camera Store State ────────────────────────────────────────────────────────
interface CameraStoreState {
  // Current camera operational mode
  mode: CameraMode;
  
  // High-level tracking flags for HUD/UI presentation
  isTransitioning: boolean;
  isTracking: boolean; // True when camera is actively locking target
  /** True while the camera still sits at its home framing (initial or post-Reset overview) */
  isHomeView: boolean;
  
  // Detailed transition parameters for interpolations
  transition: CameraTransitionState | null;
  
  // Normalized zoom value for UI feedback (0 to 1)
  zoomProgress: number;
  
  // Programmatic actions
  setMode: (mode: CameraMode) => void;
  completeTransition: () => void;
  cancelTransition: () => void;
  setZoomProgress: (progress: number) => void;
  setHomeView: (isHome: boolean) => void;
  
  // Special mission operations
  triggerLocateISS: () => void;
  triggerResetView: (overviewDistanceKm: number) => void;
}

export const useCameraStore = create<CameraStoreState>((set) => ({
  mode: 'PLANETARY',
  isTransitioning: false,
  isTracking: false,
  isHomeView: true,
  transition: null,
  zoomProgress: 0,
  
  setMode: (mode) => set((state) => {
    if (state.mode === mode) return {};
    
    // Tracking is active in FOLLOW and INSPECT modes
    const isTracking = mode === 'FOLLOW' || mode === 'INSPECT' || mode === 'APPROACH';
    
    return {
      mode,
      isTracking,
    };
  }),
  
  completeTransition: () => set((state) => {
    if (!state.transition || !state.isTransitioning) return state;
    
    return {
      isTransitioning: false,
      mode: state.transition.toMode,
      isTracking: state.transition.toMode === 'FOLLOW',
      transition: {
        ...state.transition,
        isCompleted: true,
      }
    };
  }),

  cancelTransition: () => set((state) => ({
    isTransitioning: false,
    transition: null,
    isTracking: state.mode === 'FOLLOW' || state.mode === 'INSPECT' || state.mode === 'APPROACH',
  })),
  
  setZoomProgress: (progress) => set(() => ({
    zoomProgress: Math.max(0, Math.min(1, progress))
  })),

  setHomeView: (isHome) => set((state) => (
    state.isHomeView === isHome ? state : { isHomeView: isHome }
  )),

  /**
   * (Re-)fly to the station from wherever the camera is now. Always allowed —
   * pressing it mid-flight re-captures the flight from the rendered pose, the
   * same way Reset View re-flies home — so the control behaves predictably at
   * any moment instead of being gated behind an in-progress transition.
   */
  triggerLocateISS: () => {
    useLoadingStore.getState().requestISSDetail()
    const state = useCameraStore.getState()
    set({
      isTransitioning: true,
      transition: {
        fromMode: state.mode,
        toMode: 'FOLLOW',
        startTime: Date.now(),
        durationMs: 2000,
        isCompleted: false,
      },
    })
  },

  /** (Re-)fly home to the Earth overview, also re-capturable mid-flight. */
  triggerResetView: (overviewDistanceKm) => set((state) => ({
    isTransitioning: true,
    isTracking: false,
    transition: {
      fromMode: state.mode,
      toMode: 'ORBITAL',
      overviewDistanceKm,
      startTime: Date.now(),
      durationMs: 2200,
      isCompleted: false,
    },
  })),
}));

