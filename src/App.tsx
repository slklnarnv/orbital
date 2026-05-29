import React, { useEffect, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { initTelemetryStoreListeners } from '@/stores/telemetryStore'
import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { SceneRoot } from '@/rendering/scene/SceneRoot'
import { TopBar } from '@/ui/layout/TopBar'
import { TelemetryPanel } from '@/ui/panels/TelemetryPanel'
import { CameraPanel } from '@/ui/panels/CameraPanel'
import { DataSourceIndicator } from '@/ui/panels/DataSourceIndicator'

/**
 * Pure JavaScript utility to check if WebGL is available in the current browser session.
 */
function checkWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      window.WebGL2RenderingContext ||
      (window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl')))
    )
  } catch (e) {
    return false
  }
}

/**
 * HudOverlay composes our clean, modular, NASA/JPL/ESA-inspired aerospace panels.
 * By keeping this container static, we ensure that high-frequency clock ticks and coordinate 
 * updates are confined strictly to their dedicated sub-panels, delivering absolute
 * render isolation and stable 60 FPS performance.
 */
const HudOverlay = React.memo(function HudOverlay(): JSX.Element {
  return (
    <>
      {/* Unified Aerospace Brand & High-Precision UTC Clock */}
      <TopBar />

      {/* Structured Left Dashboard Grid */}
      <div className="absolute top-16 left-6 z-10 flex flex-col gap-3 w-80 select-none">
        <TelemetryPanel />
        <CameraPanel />
        <DataSourceIndicator />
      </div>

      {/* Dynamic watermarked status indicator in the bottom right corner */}
      <div className="absolute bottom-6 right-6 z-10 flex flex-col items-end opacity-25 select-none">
        <span className="text-[9px] font-sans tracking-widest text-[var(--color-text-secondary)] uppercase">
          Aerospace Visualization Platform
        </span>
        <span className="text-[9px] font-mono text-[var(--color-text-primary)] mt-0.5">
          Phase 2.1 Stable
        </span>
      </div>
    </>
  )
})


/**
 * WebGLDiagnosticScreen renders when graphics hardware acceleration is missing.
 */
function WebGLDiagnosticScreen(): JSX.Element {
  return (
    <div className="w-full h-full relative overflow-hidden bg-[var(--color-bg)] text-[var(--color-text-primary)] flex items-center justify-center p-6 select-none">
      <div className="glass-panel p-8 max-w-xl flex flex-col gap-6 shadow-2xl">
        <div>
          <h1 className="text-display text-red-400 tracking-wide font-semibold uppercase">
            System Hardware Limitation Detected
          </h1>
          <p className="text-label text-[10px] opacity-75 mt-1">
            WebGL 3D Context Allocation Failed
          </p>
        </div>

        <div className="h-px bg-white/10" />

        <div className="flex flex-col gap-3 text-sm text-[var(--color-text-secondary)]">
          <p>
            The <strong>Orbital ISS Visualization Platform</strong> requires a high-performance WebGL 3D context to render planetary-scale environments, dynamic orbit prediction layers, and architectural ISS modules.
          </p>
          <p>
            Your browser was unable to allocate a WebGL rendering instance. This is typically caused by disabled graphics hardware acceleration or outdated display drivers in your environment.
          </p>
        </div>

        <div className="bg-red-950/40 border border-red-500/20 rounded-md p-4 flex flex-col gap-2">
          <span className="text-label text-red-400 text-xs">To Resolve This Issue:</span>
          <ul className="list-decimal pl-5 text-xs text-[var(--color-text-primary)] flex flex-col gap-1.5 leading-relaxed">
            <li>
              <strong>Enable Graphics Acceleration:</strong> Go to Chrome <code>Settings &gt; System</code> and ensure <strong>"Use graphics acceleration when available"</strong> is toggled <strong>ON</strong>.
            </li>
            <li>
              <strong>Bypass Driver Blocking:</strong> Open a new tab to <code>chrome://flags</code>, search for <strong>"Override software rendering list"</strong>, and set it to <strong>Enabled</strong>.
            </li>
            <li>
              <strong>Relaunch Your Browser:</strong> Click the <strong>Relaunch</strong> button or completely restart Chrome to apply the hardware override.
            </li>
          </ul>
        </div>

        <div className="h-px bg-white/10" />

        <div className="flex justify-between items-center text-xs opacity-50">
          <span>Client Environment: Windows WebGL 1.0/2.0</span>
          <span className="font-mono">Error Code: E_CONTEXT_ALLOCATION_FAIL</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Minimalist, high-fidelity loading screen with a rotating tilted Earth logo
 * and clear progress percentage.
 */
function LoadingScreen(): JSX.Element | null {
  const { active, progress } = useProgress()
  const [mounted, setMounted] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    if (progress >= 100 && !active) {
      // Delay slightly (e.g. 400ms) so the user can see 100% loaded state, then trigger fade out
      const fadeTimer = setTimeout(() => {
        setFadeOut(true)

        // Complete unmount after CSS fade-out transition completes (800ms)
        const unmountTimer = setTimeout(() => {
          setMounted(false)
        }, 800)

        return () => clearTimeout(unmountTimer)
      }, 400)

      return () => clearTimeout(fadeTimer)
    } else {
      setMounted(true)
      setFadeOut(false)
    }
  }, [progress, active])

  if (!mounted) return null

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#050814] select-none transition-opacity duration-800 ease-in-out ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="flex flex-col items-center justify-center">
        {/* Rotating Minimalist Earth wireframe logo (tilted at 23.5 degrees) */}
        <div
          className="relative w-28 h-28 flex items-center justify-center pointer-events-none animate-pulse-subtle"
          style={{ transform: 'rotate(23.5deg)' }}
        >
          <svg
            className="w-full h-full text-blue-400 animate-spin-earth"
            viewBox="0 0 100 100"
            fill="none"
          >
            {/* Earth outer outline with light drop glow */}
            <circle
              cx="50"
              cy="50"
              r="46"
              stroke="currentColor"
              strokeWidth="1.5"
              className="opacity-90"
              style={{ filter: 'drop-shadow(0 0 6px rgba(96, 165, 250, 0.5))' }}
            />

            {/* Latitude Grid lines */}
            <ellipse cx="50" cy="50" rx="46" ry="16" stroke="currentColor" strokeWidth="1" className="opacity-40" />
            <ellipse cx="50" cy="50" rx="46" ry="32" stroke="currentColor" strokeWidth="1" className="opacity-20" />
            <line x1="4" y1="50" x2="96" y2="50" stroke="currentColor" strokeWidth="1" className="opacity-50" />

            {/* Longitude Grid lines */}
            <ellipse cx="50" cy="50" rx="16" ry="46" stroke="currentColor" strokeWidth="1" className="opacity-60" />
            <ellipse cx="50" cy="50" rx="32" ry="46" stroke="currentColor" strokeWidth="1" className="opacity-30" />
            <line x1="50" y1="4" x2="50" y2="96" stroke="currentColor" strokeWidth="1" className="opacity-50" />
          </svg>
        </div>

        {/* Minimal loading text with percentage indicator */}
        <span className="text-xs font-mono tracking-[0.25em] text-[var(--color-text-secondary)] mt-6 uppercase">
          Loading {Math.round(progress)}%
        </span>

        {/* Clean, minimalist progress line */}
        <div className="w-48 h-0.5 bg-white/5 rounded-full overflow-hidden mt-3 border border-white/5">
          <div
            className="h-full bg-blue-500 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(96,165,250,0.6)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * App is the root container of the application.
 *
 * By decoupling HudOverlay reactive states, App mounts SceneRoot exactly once
 * and NEVER re-renders, preventing 3D scene-graph rebuilds and WebGL state resets.
 */
export default function App(): JSX.Element {
  const [webGlSupported, setWebGlSupported] = useState(true)

  useEffect(() => {
    // 1. Validate WebGL capability in the active session
    const isSupported = checkWebGLSupport()
    setWebGlSupported(isSupported)

    // 2. Initialize store listeners to bridge event bus to Zustand state
    const unsubscribeListeners = initTelemetryStoreListeners()

    // 3. Start the telemetry manager network checks, cached TLE load, and live fetches
    telemetryManager.start()

    return () => {
      // Clean up telemetry connections and listeners on unmount
      unsubscribeListeners()
      telemetryManager.stop()
    };
  }, [])

  if (!webGlSupported) {
    return <WebGLDiagnosticScreen />
  }

  return (
    <div className="w-full h-full relative overflow-hidden bg-[var(--color-bg)] text-[var(--color-text-primary)] select-none">
      {/* Layer 3: High-Performance 3D R3F Viewport - Stable (Never Re-renders!) */}
      <div className="absolute inset-0 z-0 w-full h-full">
        <SceneRoot />
      </div>

      {/* Layer 5: Time and Telemetry HUD - Reactive Overlay */}
      <HudOverlay />

      {/* Layer 6: High-Fidelity Cinematic Loading Screen */}
      <LoadingScreen />
    </div>
  )
}
