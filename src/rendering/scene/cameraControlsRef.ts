// ─── Camera Controls Ref ──────────────────────────────────────────────────────
//
// A module-level mutable ref for the CameraControls instance that lives
// inside the R3F Canvas.
//
// Purpose: allows React DOM components (HudOverlay, buttons) to imperatively
// drive camera transitions without Zustand, prop-drilling, or R3F context hacks.
//
// Lifecycle:
//   - SceneRoot assigns this ref when CameraControls mounts.
//   - HudOverlay reads this ref in event handlers (not in render, no reactivity needed).
//   - Safe to read as null — CameraControls may not yet be mounted on first clicks.
//
// Phase 2H: replace with a typed CameraStore + CameraStateMachine.

import type CameraControls from 'camera-controls'

export const cameraControlsRef: { current: CameraControls | null } = { current: null }
