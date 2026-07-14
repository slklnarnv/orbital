import React, { useEffect, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { initTelemetryStoreListeners } from '@/stores/telemetryStore'
import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { simulationRuntime } from '@/core/runtime/runtimeInstance'
import { SceneRoot } from '@/rendering/scene/SceneRoot'
import { TopBar } from '@/ui/layout/TopBar'
import { TelemetryPanel } from '@/ui/panels/TelemetryPanel'
import { CameraPanel } from '@/ui/panels/CameraPanel'
import { DataSourceIndicator } from '@/ui/panels/DataSourceIndicator'
import { useLoadingStore } from '@/stores/loadingStore'

/**
 * Pure JavaScript utility to check if WebGL is available in the current browser session.
 *
 * IMPORTANT: We always attempt actual context creation rather than checking for the
 * constructor (e.g. `window.WebGL2RenderingContext`). The constructor is present on
 * the Window object in all modern browsers regardless of GPU driver status — checking
 * for it always returns true even when the GPU is driver-blocklisted or hardware
 * acceleration is disabled. Only a canvas.getContext() call reveals the real picture.
 */
function checkWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = (
      canvas.getContext('webgl2') as WebGLRenderingContext | null ||
      canvas.getContext('webgl') as WebGLRenderingContext | null ||
      canvas.getContext('experimental-webgl') as WebGLRenderingContext | null
    )
    // Release the probed context immediately — browsers cap at ~16 live contexts.
    // Not releasing it here wastes one slot for the lifetime of the tab.
    if (gl) {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    return !!gl
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
      <main
        aria-label="Mission telemetry and camera controls"
        className="hud-panel-stack z-10 flex flex-col gap-3 select-none"
      >
        <TelemetryPanel />
        <CameraPanel />
        <DataSourceIndicator />
      </main>

      {/* Dynamic watermarked status indicator in the bottom right corner */}
      <footer className="hud-footer absolute bottom-6 right-6 z-10 flex flex-col items-end select-none">
        <span className="text-[9px] font-sans tracking-widest text-[var(--color-text-secondary)] uppercase">
          Aerospace Visualization Platform
        </span>
        <span className="text-[9px] font-mono text-[var(--color-text-primary)] mt-0.5">
          Phase 2.1 Stable
        </span>
      </footer>
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
              <strong>Enable Hardware Acceleration:</strong> In your browser settings, locate the <strong>System</strong> or <strong>Advanced</strong> section and ensure <strong>"Use hardware acceleration when available"</strong> (or equivalent) is toggled <strong>ON</strong>.
            </li>
            <li>
              <strong>Update Your Graphics Drivers:</strong> Visit your GPU manufacturer&apos;s website (NVIDIA, AMD, or Intel) and install the latest display drivers for your hardware.
            </li>
            <li>
              <strong>Relaunch Your Browser:</strong> Fully close and reopen your browser after changing settings to apply hardware changes.
            </li>
            <li>
              <strong>Try a Different Browser:</strong> If the issue persists, try opening this application in Chrome, Firefox, or Edge to isolate browser-specific blocklisting.
            </li>
          </ul>
        </div>

        <div className="h-px bg-white/10" />

        <div className="flex justify-between items-center text-xs opacity-50">
          <span>Client Environment: {navigator.platform || navigator.userAgent.split(' ')[0]} — WebGL Unavailable</span>
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
  const prewarmingComplete = useLoadingStore((state) => state.prewarmingComplete)
  const [mounted, setMounted] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)

  // Freeze the displayed progress at 100% once we start the fade-out sequence
  // to prevent the visual "double load" glitch (0->100->0->100).
  const displayProgress = hasLoaded ? 100 : progress

  // Dynamic message to keep the user informed during download vs. GPU initialization stages
  const statusMessage = (!prewarmingComplete && progress >= 100 && !active)
    ? 'Initializing Graphics'
    : `Loading ${Math.round(displayProgress)}%`

  useEffect(() => {
    // If we have already started the exit sequence, ignore further useProgress updates.
    // This prevents the loading screen from returning once it starts fading out.
    if (hasLoaded) return

    // Wait until downloads complete (progress >= 100 & !active) AND the GPU prewarmer completes
    if (progress >= 100 && !active && prewarmingComplete) {
      setHasLoaded(true)

      // We purposefully DO NOT return a cleanup function (clearTimeout) here.
      // If we did, the re-render caused by setHasLoaded(true) would execute the
      // cleanup function, cancelling the timers and permanently freezing the 
      // loading screen at 100%. 
      setTimeout(() => {
        setFadeOut(true)

        setTimeout(() => {
          setMounted(false)
        }, 800)
      }, 400)
    }
  }, [progress, active, prewarmingComplete, hasLoaded])

  if (!mounted) return null

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#050814] select-none transition-opacity duration-800 ease-in-out ${fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
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

        {/* Minimal loading text with percentage/status indicator */}
        <span className="text-xs font-mono tracking-[0.25em] text-[var(--color-text-secondary)] mt-6 uppercase">
          {statusMessage}
        </span>

        {/* Clean, minimalist progress line */}
        <div className="w-48 h-0.5 bg-white/5 rounded-full overflow-hidden mt-3 border border-white/5">
          <div
            className="h-full bg-blue-500 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(96,165,250,0.6)]"
            style={{ width: `${displayProgress}%` }}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * WebglLostOverlay shows when the browser temporarily reclaims the WebGL context.
 * It is styled as a premium glassmorphic HUD component.
 */
function WebglLostOverlay(): JSX.Element {
  return (
    <div className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 select-none animate-fade-in">
      <div className="glass-panel p-8 max-w-md w-full flex flex-col items-center gap-6 shadow-2xl border border-sky-500/20 text-center">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-sky-400 opacity-20 animate-ping" />
          <div className="absolute inset-1 rounded-full border border-sky-500 opacity-40 animate-pulse" />
          <svg className="w-8 h-8 text-sky-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.656 48.656 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3M1.5 12a11.963 11.963 0 00.138 3.662 4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M1.5 12l-3 3m3-3l3 3" />
          </svg>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-display text-sky-400 tracking-wide font-semibold uppercase text-lg">
            Graphics Context Disconnected
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            The browser reclaimed the WebGL rendering context. Attempting to restore graphics hardware session...
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * WebglFailedOverlay shows when restoration times out and consecutive reloads occurred
 * within the protection window.
 */
function WebglFailedOverlay(): JSX.Element {
  return (
    <div className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-md flex items-center justify-center p-6 select-none animate-fade-in">
      <div className="glass-panel p-8 max-w-md w-full flex flex-col items-center gap-6 shadow-2xl border border-red-500/25 text-center">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-red-500 opacity-20 animate-pulse" />
          <svg className="w-8 h-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-display text-red-400 tracking-wide font-semibold uppercase text-lg">
            Graphics Recovery Failed
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            The WebGL context could not be restored automatically. This can occur under heavy memory pressure or GPU driver instability.
          </p>
        </div>
        <button
          onClick={() => {
            sessionStorage.setItem('orbital_last_webgl_reload', Date.now().toString())
            window.location.reload()
          }}
          className="px-5 py-2.5 bg-red-950/60 hover:bg-red-900/60 border border-red-500/30 text-red-200 text-xs font-mono tracking-wider uppercase rounded-sm transition-all active:scale-[0.98] cursor-pointer animate-pulse-subtle"
        >
          Force Reload Session
        </button>
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
  // APP-1 FIX: Use lazy initial state so checkWebGLSupport() runs BEFORE any render.
  // Previously this was in a useEffect (post-render), which meant R3F's Canvas mounted
  // and threw before the check could set webGlSupported=false. The lazy initializer
  // runs synchronously during the first render, gating Canvas mount correctly.
  const [webGlSupported] = useState(() => checkWebGLSupport())
  const [webglStatus, setWebglStatus] = useState<'ok' | 'lost' | 'failed'>('ok')

  useEffect(() => {
    // 1. Initialize store listeners to bridge event bus to Zustand state
    const unsubscribeListeners = initTelemetryStoreListeners()

    // 2. Start telemetry lifecycle and the application-owned simulation scheduler.
    // The runtime can begin immediately because ISSEntity installs a fallback TLE
    // synchronously; live/cached data replaces it when bootstrap completes.
    void telemetryManager.start()
    simulationRuntime.start()

    return () => {
      // Stop producers before removing their consumers. Both lifecycle owners are
      // idempotent so React StrictMode's development remount cannot duplicate work.
      simulationRuntime.stop()
      telemetryManager.stop()
      unsubscribeListeners()
    }
  }, [])

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null

    const handleLost = (e: Event) => {
      // Intercept context loss only for canvas elements that are currently part of the active DOM.
      // This filters out the temporary off-screen context checks in checkWebGLSupport.
      if (e.target instanceof HTMLCanvasElement && document.body.contains(e.target)) {
        e.preventDefault()
        console.warn('[App] WebGL context lost detected.')
        setWebglStatus('lost')

        // Set a 5-second timer to wait for WebGL context restoration
        timerId = setTimeout(() => {
          // Check reload loop protection in sessionStorage (15-second window)
          const lastReloadStr = sessionStorage.getItem('orbital_last_webgl_reload')
          const now = Date.now()
          if (lastReloadStr) {
            const lastReload = parseInt(lastReloadStr, 10)
            if (now - lastReload < 15000) {
              // Reloaded recently, do not auto-reload again
              setWebglStatus('failed')
              return
            }
          }
          // Record reload timestamp and trigger page reload
          sessionStorage.setItem('orbital_last_webgl_reload', now.toString())
          window.location.reload()
        }, 5000)
      }
    }

    const handleRestored = (e: Event) => {
      if (e.target instanceof HTMLCanvasElement && document.body.contains(e.target)) {
        console.warn('[App] WebGL context restored.')
        if (timerId) clearTimeout(timerId)
        // Hide overlay and recover normally without forced reload
        setWebglStatus('ok')
      }
    }

    // Capture phase (true) is required because webglcontextlost/restored events do not bubble
    window.addEventListener('webglcontextlost', handleLost, true)
    window.addEventListener('webglcontextrestored', handleRestored, true)

    return () => {
      if (timerId) clearTimeout(timerId)
      window.removeEventListener('webglcontextlost', handleLost, true)
      window.removeEventListener('webglcontextrestored', handleRestored, true)
    }
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

      {/* WebGL Recovery Overlays */}
      {webglStatus === 'lost' && <WebglLostOverlay />}
      {webglStatus === 'failed' && <WebglFailedOverlay />}
    </div>
  )
}
