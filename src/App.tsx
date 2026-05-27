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
 * High-Fidelity Cinematic Loading Screen.
 * Displays concentric rotating telemetry circles, SVG loading arc, and dynamic aerospace boot statuses.
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
      // If it starts loading again for some reason, ensure it stays mounted
      setMounted(true)
      setFadeOut(false)
    }
  }, [progress, active])

  if (!mounted) return null

  // Map progress to beautiful aerospace boot messages
  let statusText = "SYSTEM BOOTSTRAP IN PROGRESS..."
  if (progress < 20) {
    statusText = "ALLOCATING WEBGL GRAPHICS CONTEXT..."
  } else if (progress < 45) {
    statusText = "COMPILING ATMOSPHERIC SCATTERING SHADERS..."
  } else if (progress < 70) {
    statusText = "DESERIALIZING 8K BLUE MARBLE TEXTURES..."
  } else if (progress < 90) {
    statusText = "ESTABLISHING ISS REAL-TIME TELEMETRY STREAM..."
  } else if (progress < 100) {
    statusText = "STABILIZING ORBITAL LIGHTING HIERARCHY..."
  } else {
    statusText = "FLIGHT DECK INITIALIZED. WELCOME ABOARD."
  }

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#050814] loading-grid scanline-effect select-none transition-opacity duration-800 ease-in-out ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Decorative Spinning Concentric Orbits (SpaceX / JPL visual aesthetic) */}
      <div className="absolute top-1/2 left-1/2 w-[540px] h-[540px] border border-blue-500/10 rounded-full animate-spin-cw pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 w-[380px] h-[380px] border border-dashed border-blue-400/5 rounded-full animate-spin-ccw pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 w-[220px] h-[220px] border border-blue-500/10 rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2 opacity-30 animate-pulse-subtle" />

      {/* Central Dashboard Panel */}
      <div className="glass-panel p-8 w-[400px] flex flex-col items-center gap-6 shadow-[0_20px_50px_rgba(0,0,0,0.8)] z-10 border-blue-500/15">
        <div className="flex flex-col items-center w-full">
          <span className="text-[10px] tracking-[0.25em] text-[var(--color-accent)] font-mono uppercase animate-pulse-subtle">
            ORBITAL VISUALIZATION
          </span>
          <h2 className="text-display text-white text-base tracking-widest font-semibold uppercase mt-1 font-sans">
            SYSTEM INITIALIZATION
          </h2>
        </div>

        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Glowing Circular Progress indicator */}
        <div className="relative w-36 h-36 flex items-center justify-center">
          {/* Outer dotted tracking circle */}
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="72"
              cy="72"
              r="54"
              stroke="rgba(96,165,250,0.06)"
              strokeWidth="2"
              fill="transparent"
            />
            <circle
              cx="72"
              cy="72"
              r="54"
              stroke="var(--color-accent)"
              strokeWidth="3.5"
              fill="transparent"
              strokeDasharray={339}
              strokeDashoffset={339 - (339 * progress) / 100}
              className="transition-all duration-300 ease-out"
              strokeLinecap="round"
              style={{ filter: 'drop-shadow(0 0 4px rgba(96,165,250,0.5))' }}
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-2xl font-mono text-white font-light tracking-tighter">
              {Math.round(progress)}
              <span className="text-xs text-[var(--color-accent)] ml-0.5">%</span>
            </span>
            <span className="text-[8px] font-mono tracking-widest text-[var(--color-text-secondary)] uppercase mt-1">
              LNK_LOAD
            </span>
          </div>
        </div>

        <div className="w-full flex flex-col gap-2">
          {/* Fine HUD Readout Text */}
          <div className="flex justify-between items-center text-[9px] font-mono text-[var(--color-text-secondary)] px-1">
            <span className="tracking-wide">TELEMETRY_LINK: STATUS_OK</span>
            <span className="text-[var(--color-accent)] font-semibold">
              {Math.round(progress * 10) / 10} / 100.0
            </span>
          </div>

          {/* Glowing Gradient Loading Bar Container */}
          <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden border border-white/5">
            <div 
              className="h-full loading-gradient-bar"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Tactical Status Label */}
        <div className="flex flex-col items-center">
          <span className="text-[9px] font-mono text-[var(--color-text-secondary)] text-center tracking-wide min-h-[14px]">
            {statusText}
          </span>
        </div>
      </div>

      {/* JPL/SpaceX Inspired Bottom Telemetry Link watermark */}
      <div className="absolute bottom-10 flex flex-col items-center opacity-40">
        <span className="text-[8px] font-mono tracking-[0.3em] text-[var(--color-text-secondary)] uppercase">
          JPL | SPX | NASA FLIGHT SOFTWARE
        </span>
        <span className="text-[8px] font-mono text-[var(--color-text-muted)] mt-1">
          SECURE LINK // 2461187.91323 JD
        </span>
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
