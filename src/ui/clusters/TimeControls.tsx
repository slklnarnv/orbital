import { useEffect, useState } from 'react'
import { simulationClock } from '@/core/clock/SimulationClock'
import { useSimulationStore } from '@/stores/simulationStore'
import { useOrbitalState } from '@/hooks/useOrbitalState'
import { periodMsOf } from '@/utils/orbitalTime'
import { TIME_RATE_PRESETS } from '@/utils/constants'
import { closeOverlay } from '../overlay/overlay'
import { useOverlay } from '../overlay/useOverlay'

/**
 * TimeControls — the transport row under the mission clock: pause/play,
 * rate presets, Live, and a seek popover.
 *
 * Vocabulary: "Live" is the wall-pinned REALTIME clock (entering it snaps
 * the epoch back to actual now — the clock's own re-pin semantics); the
 * presets are ACCELERATED rates where 1× is a free-running offset clock,
 * distinct from Live. Every seek detaches from Live into PAUSED first
 * (store.seek) because REALTIME re-pins to the wall each tick and would
 * silently discard the jump.
 *
 * Color discipline: no signal colors here — time state is not data-link
 * state. Active controls brighten to --hud-hi with an underline.
 */

/** Seek nudges applied relative to the current epoch. */
const NUDGES: Array<{ label: string; ms: (orbitMs: number) => number }> = [
  { label: '− orbit', ms: (orbit) => -orbit },
  { label: '−10 min', ms: () => -10 * 60_000 },
  { label: '−1 min', ms: () => -60_000 },
  { label: '+1 min', ms: () => 60_000 },
  { label: '+10 min', ms: () => 10 * 60_000 },
  { label: '+ orbit', ms: (orbit) => orbit },
]

/** Formats an epoch as a datetime-local value whose digits are UTC. */
function epochToUtcInputValue(epochMs: number): string {
  const d = new Date(epochMs)
  const p = (n: number): string => n.toString().padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  )
}

/** Parses a datetime-local value as UTC (the field shows Zulu time). */
function parseUtcInputValue(value: string): number | null {
  if (!value) return null
  const ms = Date.parse(`${value}Z`)
  return Number.isFinite(ms) ? ms : null
}

export function TimeControls(): JSX.Element {
  const mode = useSimulationStore((state) => state.mode)
  const timeScale = useSimulationStore((state) => state.timeScale)
  const { orbitalPeriod } = useOrbitalState()

  // Shared overlay system (ui/overlay/overlay.ts): Escape closes the seek
  // popover and focus returns to Set time. Space (pause) lives in the
  // shortcut registry with the other global keys.
  const { isOpen: seekOpen, triggerRef, panelRef, onTriggerClick } = useOverlay('seek')
  const [inputValue, setInputValue] = useState(() =>
    epochToUtcInputValue(simulationClock.now().epochMs),
  )

  // Each open starts from the current epoch.
  useEffect(() => {
    if (seekOpen) setInputValue(epochToUtcInputValue(simulationClock.now().epochMs))
  }, [seekOpen])

  const paused = mode === 'PAUSED'
  const parsedValue = parseUtcInputValue(inputValue)
  const orbitMs = periodMsOf(orbitalPeriod)

  const applySeek = (epochMs: number, close: boolean): void => {
    useSimulationStore.getState().seek(epochMs)
    if (close) {
      closeOverlay()
    } else {
      setInputValue(epochToUtcInputValue(simulationClock.now().epochMs))
    }
  }

  const transportButton = (active: boolean): string =>
    `hud-transport__btn${active ? ' hud-transport__btn--active' : ''}`

  return (
    <div className="hud-transport">
      <button
        type="button"
        className={`${transportButton(paused)} hud-transport__icon`}
        aria-label={paused ? 'Resume time' : 'Pause time'}
        aria-keyshortcuts="Space"
        onClick={() => useSimulationStore.getState().togglePause()}
      >
        {paused ? (
          <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true" focusable="false">
            <path d="M1.5 0.8 L8 5 L1.5 9.2 Z" fill="currentColor" />
          </svg>
        ) : (
          <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true" focusable="false">
            <rect x="0.8" y="0.8" width="2.4" height="8.4" fill="currentColor" />
            <rect x="5.8" y="0.8" width="2.4" height="8.4" fill="currentColor" />
          </svg>
        )}
      </button>

      {TIME_RATE_PRESETS.map((rate, i) => {
        const active = mode === 'ACCELERATED' && timeScale === rate
        return (
          <button
            key={rate}
            type="button"
            className={transportButton(active)}
            aria-pressed={active}
            aria-label={`Time rate ${rate}×`}
            aria-keyshortcuts={String(i + 1)}
            onClick={() => useSimulationStore.getState().setRate(rate)}
          >
            {rate}×
          </button>
        )
      })}

      <button
        type="button"
        className={transportButton(mode === 'REALTIME')}
        aria-pressed={mode === 'REALTIME'}
        aria-label="Live — return to wall-clock time"
        aria-keyshortcuts="0"
        onClick={() => useSimulationStore.getState().setMode('REALTIME')}
      >
        Live
      </button>

      <button
        ref={triggerRef}
        type="button"
        className={transportButton(false)}
        aria-expanded={seekOpen}
        aria-label="Set simulation time"
        data-overlay=""
        onClick={onTriggerClick}
      >
        Set time
      </button>

      {seekOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Set simulation time"
          className="hud-transport-popover hud-text"
          data-overlay=""
        >
          <span className="hud-fine" style={{ color: 'var(--hud-lo)', letterSpacing: '0.18em' }}>
            Set time · UTC
          </span>
          <input
            className="hud-transport-input"
            type="datetime-local"
            step={1}
            value={inputValue}
            aria-label="Simulation time, UTC"
            onChange={(event) => setInputValue(event.target.value)}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 8 }}>
            {NUDGES.map((nudge) => (
              <button
                key={nudge.label}
                type="button"
                className="hud-transport__btn"
                onClick={() => applySeek(simulationClock.now().epochMs + nudge.ms(orbitMs), false)}
              >
                {nudge.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${transportButton(true)}`}
            style={{ marginTop: 8, alignSelf: 'flex-end' }}
            disabled={parsedValue === null}
            onClick={() => parsedValue !== null && applySeek(parsedValue, true)}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
