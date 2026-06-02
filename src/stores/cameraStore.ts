import { create } from 'zustand'
import { CameraMode, CameraTransitionState } from '@/types/camera'

// ─── Camera Store State ────────────────────────────────────────────────────────
interface CameraStoreState {
  // Current camera operational mode
  mode: CameraMode;
  
  // High-level tracking flags for HUD/UI presentation
  isTransitioning: boolean;
  isTracking: boolean; // True when camera is actively locking target
  
  // Detailed transition parameters for interpolations
  transition: CameraTransitionState | null;
  
  // Normalized zoom value for UI feedback (0 to 1)
  zoomProgress: number;
  
  // Programmatic actions
  setMode: (mode: CameraMode) => void;
  completeTransition: () => void;
  setZoomProgress: (progress: number) => void;
  
  // Special mission operations
  triggerLocateISS: () => void;
}

export const useCameraStore = create<CameraStoreState>((set) => ({
  mode: 'PLANETARY',
  isTransitioning: false,
  isTracking: false,
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
    if (!state.transition) return {};
    
    return {
      isTransitioning: false,
      mode: state.transition.toMode,
      transition: {
        ...state.transition,
        isCompleted: true,
      }
    };
  }),
  
  setZoomProgress: (progress) => set(() => ({
    zoomProgress: Math.max(0, Math.min(1, progress))
  })),
  
  triggerLocateISS: () => set((state) => {
    // Transitioning to FOLLOW mode
    return {
      isTransitioning: true,
      isTracking: true,
      transition: {
        fromMode: state.mode,
        toMode: 'FOLLOW',
        startTime: Date.now(),
        durationMs: 2000, // Cinematic 2-second flight
        isCompleted: false,
      }
    };
  })
}));

