import { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { useSimulationStore } from './stores/simulationStore'

interface Props {
  children?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Standard diagnostic ErrorBoundary to catch and display React render crashes.
 */
class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Orbital ErrorBoundary] Caught error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '24px',
          background: '#1c0e0e',
          color: '#fca5a5',
          fontFamily: 'Consolas, Monaco, monospace',
          height: '100vh',
          overflow: 'auto',
          borderTop: '6px solid #ef4444',
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 12px 0' }}>
            [Orbital] Critical Rendering Crash Detected
          </h2>
          <p style={{ margin: '0 0 16px 0', opacity: 0.8 }}>
            An exception occurred during the React rendering lifecycle. Details below:
          </p>
          <pre style={{
            background: '#090505',
            padding: '16px',
            borderRadius: '6px',
            overflowX: 'auto',
            border: '1px solid #7f1d1d',
            lineHeight: 1.5,
          }}>
            {this.state.error?.stack || this.state.error?.toString()}
          </pre>
          <p style={{ marginTop: '20px', fontSize: '12px', opacity: 0.6 }}>
            Submit this traceback to diagnose the rendering baseline.
          </p>
        </div>
      )
    }

    return this.props.children
  }
}

// Hook into global window errors to log them safely to the console without interfering with React's DOM tree
window.addEventListener('error', (event) => {
  console.error('[Global Runtime Error]', event.error || event.message)
})

// DEV TEST HOOK (plan 001 §7 fault-injection matrix): `?failAssets=igoal,legacy`
// answers matching asset requests with HTTP 503 so model-load failures can be
// exercised from a fresh page load. Dev builds only.
if (import.meta.env.DEV) {
  const failList = new URLSearchParams(window.location.search).get('failAssets')
  if (failList) {
    const needles = failList.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const originalFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (needles.some((needle) => url.toLowerCase().includes(needle))) {
        return Promise.resolve(new Response('injected failure', { status: 503 }))
      }
      return originalFetch(input, init)
    }
  }
}

// DEV DEBUG HOOK: expose the simulation store for runtime diagnostics
// (time acceleration during visual verification), matching __orbitalControls.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__orbitalSimulation = useSimulationStore
  import('./core/telemetry/TelemetryManager').then((m) => {
    ;(window as unknown as Record<string, unknown>).__orbitalTelemetry = m.telemetryManager
  })
  import('./core/clock/SimulationClock').then((m) => {
    ;(window as unknown as Record<string, unknown>).__orbitalClock = m.simulationClock
  })
}

// NOTE: React.StrictMode is intentionally NOT used here.
//
// In development, StrictMode double-invokes effects and mounts components twice
// to help surface side effects. However, React Three Fiber's WebGL canvas creates
// a GPU rendering context that is destroyed and recreated on double-mount — wiping
// all GPU state (shaders, textures, buffers). This produces a reliable black screen
// in development with Strict Mode enabled, with no benefit for WebGL applications.
//
// The ErrorBoundary above provides the safety net for render-phase crashes. Strict
// Mode's double-mount guarantees are not applicable to imperative WebGL rendering.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
