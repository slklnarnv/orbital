import React, { useEffect, useState } from 'react'
import { initTelemetryStoreListeners } from '@/stores/telemetryStore'
import { markLinkSettled } from '@/stores/bootStore'
import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { simulationRuntime } from '@/core/runtime/runtimeInstance'
import { SceneRoot } from '@/rendering/scene/SceneRoot'
import { scheduleLocatePrefetch } from '@/rendering/iss/prefetchDetail'
import { geoLookupService } from '@/core/geo/GeoLookupService'
import { useShortcuts } from '@/ui/shortcuts/useShortcuts'
import { ShortcutHelp } from '@/ui/overlay/ShortcutHelp'
import { SceneAnnouncer, SceneSummary, SCENE_SUMMARY_ID } from '@/ui/a11y/SceneAnnouncer'
import { TopBar } from '@/ui/layout/TopBar'
import { GaugesCluster } from '@/ui/clusters/GaugesCluster'
import { MissionClockCluster } from '@/ui/clusters/MissionClockCluster'
import { CameraCluster } from '@/ui/clusters/CameraCluster'
import { GroundTrackGlobe } from '@/ui/clusters/GroundTrackGlobe'
import { OrbitTape } from '@/ui/clusters/OrbitTape'
import { ModuleExplorerPanel } from '@/ui/clusters/ModuleExplorerPanel'
import { LoadingScreen } from '@/ui/loading/LoadingScreen'

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
 *
 * Keyboard and screen-reader layer (roadmap 017 A): one global shortcut
 * handler, a skip link past the top bar, the canvas described in words and a
 * polite live region for mode and daylight changes.
 */
const HudOverlay = React.memo(function HudOverlay(): JSX.Element {
  useShortcuts()

  return (
    <>
      <a
        href="#hud-main"
        className="hud-skip-link"
        onClick={(event) => {
          // Focus without rewriting the URL's hash.
          event.preventDefault()
          document.getElementById('hud-main')?.focus()
        }}
      >
        Skip to time and camera controls
      </a>
      <SceneSummary />
      <SceneAnnouncer />

      {/* Edge scrims: legibility gradients, never interactive */}
      <div aria-hidden="true" className="hud-scrim hud-scrim--top" />
      <div aria-hidden="true" className="hud-scrim hud-scrim--bottom" />

      <TopBar />

      <main id="hud-main" tabIndex={-1} aria-label="Mission telemetry and camera controls" className="hud-frame select-none">
        <OrbitTape />
        <GaugesCluster />
        <MissionClockCluster />
        <div className="hud-bottom-right">
          <GroundTrackGlobe />
        </div>
        <CameraCluster />
      </main>

      <ModuleExplorerPanel />
      <ShortcutHelp />
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
    // The loading screen's data-link stage reads the outcome once it settles.
    void telemetryManager.start().finally(markLinkSettled)
    simulationRuntime.start()

    // 3. Ground-point enrichment (place, local time, weather) on its own
    // rate-limited cadence — independent of telemetry mode.
    geoLookupService.start()

    // 4. Warm the fast Locate LOD after boot idle. Locate is a primary
    // feature; this moves the deferred download off the click path without
    // preloading it (see prefetchDetail.ts).
    const cancelPrefetch = scheduleLocatePrefetch()

    return () => {
      cancelPrefetch()
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
      <div
        className="absolute inset-0 z-0 w-full h-full"
        role="img"
        aria-label="Live 3D view of Earth and the International Space Station"
        aria-describedby={SCENE_SUMMARY_ID}
      >
        <SceneRoot />
      </div>

      {/* Layer 5: Broadcast HUD — Reactive Overlay */}
      <HudOverlay />

      {/* Layer 6: Loading screen (staged: data link, Earth, station) */}
      <LoadingScreen />

      {/* WebGL Recovery Overlays */}
      {webglStatus === 'lost' && <WebglLostOverlay />}
      {webglStatus === 'failed' && <WebglFailedOverlay />}
    </div>
  )
}
