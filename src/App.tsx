import React, { useEffect, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { initTelemetryStoreListeners } from '@/stores/telemetryStore'
import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { simulationRuntime } from '@/core/runtime/runtimeInstance'
import { SceneRoot } from '@/rendering/scene/SceneRoot'
import { geoLookupService } from '@/core/geo/GeoLookupService'
import { TopBar } from '@/ui/layout/TopBar'
import { GaugesCluster } from '@/ui/clusters/GaugesCluster'
import { MissionClockCluster } from '@/ui/clusters/MissionClockCluster'
import { CameraCluster } from '@/ui/clusters/CameraCluster'
import { GroundTrackGlobe } from '@/ui/clusters/GroundTrackGlobe'
import { OrbitTape } from '@/ui/clusters/OrbitTape'
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
 * HudOverlay composes the broadcast-style frame: bare instrument typography
 * anchored to the edges of the viewport, nothing floating mid-frame. Each
 * cluster subscribes to its own slice of the 1 Hz throttled stores, so
 * high-frequency updates stay confined to their dedicated components and the
 * container never re-renders.
 */
const HudOverlay = React.memo(function HudOverlay(): JSX.Element {
  return (
    <>
      {/* Edge scrims: legibility gradients, never interactive */}
      <div aria-hidden="true" className="hud-scrim hud-scrim--top" />
      <div aria-hidden="true" className="hud-scrim hud-scrim--bottom" />

      <TopBar />

      <main aria-label="Mission telemetry and camera controls" className="hud-frame select-none">
        <OrbitTape />
        <GaugesCluster />
        <MissionClockCluster />
        <div className="hud-bottom-right">
          <GroundTrackGlobe />
        </div>
        <CameraCluster />
      </main>
    </>
  )
})


/**
 * WebGLDiagnosticScreen renders when graphics hardware acceleration is missing.
 */
function WebGLDiagnosticScreen(): JSX.Element {
  return (
    <div className="w-full h-full relative overflow-hidden bg-[var(--space)] text-[var(--hud-hi)] flex items-center justify-center p-6 select-none">
      <div
        className="p-8 max-w-xl flex flex-col gap-6"
        style={{
          background: 'rgba(2, 4, 9, 0.72)',
          border: '1px solid var(--hud-line)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div>
          <h1
            className="uppercase"
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '0.14em',
              color: 'var(--signal-fault)',
            }}
          >
            System Hardware Limitation Detected
          </h1>
          <p className="hud-label" style={{ marginTop: 4 }}>
            WebGL 3D Context Allocation Failed
          </p>
        </div>

        <div style={{ height: 1, background: 'var(--hud-line)' }} />

        <div className="flex flex-col gap-3 text-sm text-[var(--hud-mid)]">
          <p>
            The <strong className="text-[var(--hud-hi)]">Orbital ISS Visualization Platform</strong> requires a high-performance WebGL 3D context to render planetary-scale environments, dynamic orbit prediction layers, and architectural ISS modules.
          </p>
          <p>
            Your browser was unable to allocate a WebGL rendering instance. This is typically caused by disabled graphics hardware acceleration or outdated display drivers in your environment.
          </p>
        </div>

        <div
          className="p-4 flex flex-col gap-2"
          style={{
            background: 'rgba(255, 92, 92, 0.06)',
            border: '1px solid rgba(255, 92, 92, 0.22)',
          }}
        >
          <span className="hud-label" style={{ color: 'var(--signal-fault)' }}>
            To Resolve This Issue:
          </span>
          <ul className="list-decimal pl-5 text-xs text-[var(--hud-hi)] flex flex-col gap-1.5 leading-relaxed">
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

        <div style={{ height: 1, background: 'var(--hud-line)' }} />

        <div className="hud-fine flex justify-between items-center" style={{ opacity: 0.7 }}>
          <span>Client Environment: {navigator.platform || navigator.userAgent.split(' ')[0]} — WebGL Unavailable</span>
          <span>Error Code: E_CONTEXT_ALLOCATION_FAIL</span>
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
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[var(--space)] select-none transition-opacity duration-800 ease-in-out ${fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
    >
      <div className="flex flex-col items-center justify-center">
        {/* Rotating Minimalist Earth wireframe logo (tilted at 23.5 degrees) */}
        <div
          className="relative w-28 h-28 flex items-center justify-center pointer-events-none animate-pulse-subtle"
          style={{ transform: 'rotate(23.5deg)' }}
        >
          <svg
            className="w-full h-full text-[var(--hud-hi)] animate-spin-earth"
            viewBox="0 0 100 100"
            fill="none"
          >
            <circle
              cx="50"
              cy="50"
              r="46"
              stroke="currentColor"
              strokeWidth="1.5"
              className="opacity-90"
              style={{ filter: 'drop-shadow(0 0 6px rgba(244, 247, 251, 0.35))' }}
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
        <span
          className="uppercase"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.25em',
            color: 'var(--hud-mid)',
            marginTop: 24,
          }}
        >
          {statusMessage}
        </span>

        {/* Clean, minimalist progress line */}
        <div
          className="w-48 overflow-hidden"
          style={{ height: 2, background: 'rgba(244, 247, 251, 0.12)', marginTop: 12 }}
        >
          <div
            className="h-full transition-all duration-300 ease-out"
            style={{ width: `${displayProgress}%`, background: 'var(--hud-hi)' }}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * WebglLostOverlay shows when the browser temporarily reclaims the WebGL context.
 */
function WebglLostOverlay(): JSX.Element {
  return (
    <div className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 select-none animate-fade-in">
      <div
        className="p-8 max-w-md w-full flex flex-col items-center gap-6 text-center"
        style={{ background: 'rgba(2, 4, 9, 0.72)', border: '1px solid var(--hud-line)' }}
      >
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div
            className="absolute inset-0 rounded-full animate-ping-ring"
            style={{ border: '1px solid var(--hud-hi)' }}
          />
          <div
            className="absolute inset-1 rounded-full animate-pulse-subtle"
            style={{ border: '1px solid var(--hud-hi)' }}
          />
          <svg
            className="w-8 h-8"
            style={{ color: 'var(--hud-hi)' }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.656 48.656 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3M1.5 12a11.963 11.963 0 00.138 3.662 4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M1.5 12l-3 3m3-3l3 3" />
          </svg>
        </div>
        <div className="flex flex-col gap-2">
          <h2
            className="uppercase"
            style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.14em', color: 'var(--hud-hi)' }}
          >
            Graphics Context Disconnected
          </h2>
          <p className="hud-fine" style={{ lineHeight: 1.7, textTransform: 'none', letterSpacing: '0.03em' }}>
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
      <div
        className="p-8 max-w-md w-full flex flex-col items-center gap-6 text-center"
        style={{
          background: 'rgba(2, 4, 9, 0.8)',
          border: '1px solid rgba(255, 92, 92, 0.3)',
        }}
      >
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div
            className="absolute inset-0 rounded-full animate-pulse-subtle"
            style={{ border: '1px solid rgba(255, 92, 92, 0.5)' }}
          />
          <svg
            className="w-8 h-8"
            style={{ color: 'var(--signal-fault)' }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <div className="flex flex-col gap-2">
          <h2
            className="uppercase"
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.14em',
              color: 'var(--signal-fault)',
            }}
          >
            Graphics Recovery Failed
          </h2>
          <p className="hud-fine" style={{ lineHeight: 1.7, textTransform: 'none', letterSpacing: '0.03em' }}>
            The WebGL context could not be restored automatically. This can occur under heavy memory pressure or GPU driver instability.
          </p>
        </div>
        <button
          onClick={() => {
            sessionStorage.setItem('orbital_last_webgl_reload', Date.now().toString())
            window.location.reload()
          }}
          className="uppercase"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.2em',
            padding: '10px 20px',
            cursor: 'pointer',
            color: 'var(--signal-fault)',
            background: 'rgba(255, 92, 92, 0.08)',
            border: '1px solid rgba(255, 92, 92, 0.35)',
            transition: 'background 150ms ease',
          }}
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

    // 3. Ground-point enrichment (place, local time, weather) on its own
    // rate-limited cadence — independent of telemetry mode.
    geoLookupService.start()

    return () => {
      // Stop producers before removing their consumers. Both lifecycle owners are
      // idempotent so React StrictMode's development remount cannot duplicate work.
      geoLookupService.stop()
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
    <div className="w-full h-full relative overflow-hidden bg-[var(--space)] text-[var(--hud-hi)] select-none">
      {/* Layer 3: High-Performance 3D R3F Viewport - Stable (Never Re-renders!) */}
      <div className="absolute inset-0 z-0 w-full h-full">
        <SceneRoot />
      </div>

      {/* Layer 5: Broadcast HUD — Reactive Overlay */}
      <HudOverlay />

      {/* Layer 6: Cinematic Loading Screen */}
      <LoadingScreen />

      {/* WebGL Recovery Overlays */}
      {webglStatus === 'lost' && <WebglLostOverlay />}
      {webglStatus === 'failed' && <WebglFailedOverlay />}
    </div>
  )
}
