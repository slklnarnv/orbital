import { useEffect, useRef, useState } from 'react'
import {
  useSettingsStore,
  type IssModelQuality,
  type OrbitLineStyle,
} from '@/stores/settingsStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { handleRadioGroupKeyDown, radioTabIndex } from './radioGroup'

const MODEL_OPTIONS: Array<{ value: IssModelQuality; label: string; hint: string }> = [
  { value: 'high', label: 'High fidelity', hint: 'IGOAL · animated' },
  { value: 'legacy', label: 'Legacy', hint: 'Performance · static' },
]

const ORBIT_LINE_OPTIONS: Array<{ value: OrbitLineStyle; label: string }> = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'dashed', label: 'Dashed' },
]

const MODEL_VALUES = MODEL_OPTIONS.map((option) => option.value)
const ORBIT_LINE_VALUES = ORBIT_LINE_OPTIONS.map((option) => option.value)

/**
 * SettingsGear — discreet render-settings access, parked in the top-right
 * corner cluster. Deliberately minimal: a gear that opens a small popover
 * with the ISS model selection and a Visuals section (bloom).
 */
export function SettingsGear(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const issModelQuality = useSettingsStore((state) => state.issModelQuality)
  const setIssModelQuality = useSettingsStore((state) => state.setIssModelQuality)
  const postprocessing = useSettingsStore((state) => state.postprocessing)
  const setPostprocessing = useSettingsStore((state) => state.setPostprocessing)
  const orbitLineStyle = useSettingsStore((state) => state.orbitLineStyle)
  const setOrbitLineStyle = useSettingsStore((state) => state.setOrbitLineStyle)
  const lensFlare = useSettingsStore((state) => state.lensFlare)
  const setLensFlare = useSettingsStore((state) => state.setLensFlare)
  // Loading indicator for the pending model candidate.
  const issDetail = useLoadingStore((state) => state.issDetail)
  const isLoadingModel = issDetail.status === 'loading' || issDetail.status === 'preparing'

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false)
    }
    // Escape is scoped: it closes this popover only when focus is inside it
    // (or nowhere), so one keypress never dismisses an unrelated popover.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const active = document.activeElement
      const focusInside = active !== null && rootRef.current?.contains(active)
      if (!focusInside && active !== document.body) return
      event.preventDefault()
      setIsOpen(false)
      if (focusInside) triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        ref={triggerRef}
        id="btn-settings"
        type="button"
        aria-label="Render settings"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="hud-btn-gear"
        style={{
          appearance: 'none',
          border: 0,
          background: 'transparent',
          padding: 5,
          margin: -5,
          borderRadius: '50%',
          cursor: 'pointer',
          color: isOpen ? 'var(--hud-hi)' : 'var(--hud-mid)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Render settings"
          className="hud-settings-popover hud-text"
        >
          <span className="hud-fine" style={{ color: 'var(--hud-lo)', letterSpacing: '0.18em' }}>
            RENDER SETTINGS
          </span>

          <span className="hud-label" style={{ marginTop: 10, color: 'var(--hud-mid)' }}>
            ISS model
          </span>

          <div
            role="radiogroup"
            aria-label="ISS model"
            style={{ display: 'grid', gap: 6, marginTop: 6 }}
            onKeyDown={(event) => handleRadioGroupKeyDown(event, MODEL_VALUES, issModelQuality, setIssModelQuality)}
          >
            {MODEL_OPTIONS.map((option) => {
              const isSelected = issModelQuality === option.value
              const isPending = isLoadingModel && issDetail.quality === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={radioTabIndex(MODEL_VALUES, issModelQuality, option.value)}
                  onClick={() => setIssModelQuality(option.value)}
                  className={`hud-label hud-option${isSelected ? ' hud-option--on' : ''}`}
                >
                  {option.label}
                  <span
                    className="hud-fine"
                    style={{ display: 'block', marginTop: 3, color: 'var(--hud-lo)', fontSize: 9 }}
                  >
                    {option.hint}
                  </span>
                  {isPending && <span className="hud-settings-spinner" aria-hidden="true" />}
                </button>
              )
            })}
          </div>

          <span className="hud-label" style={{ marginTop: 12, color: 'var(--hud-mid)' }}>
            Orbit line
          </span>

          <div
            role="radiogroup"
            aria-label="Orbit line style"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}
            onKeyDown={(event) => handleRadioGroupKeyDown(event, ORBIT_LINE_VALUES, orbitLineStyle, setOrbitLineStyle)}
          >
            {ORBIT_LINE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={orbitLineStyle === option.value}
                tabIndex={radioTabIndex(ORBIT_LINE_VALUES, orbitLineStyle, option.value)}
                onClick={() => setOrbitLineStyle(option.value)}
                className={`hud-label hud-option${orbitLineStyle === option.value ? ' hud-option--on' : ''}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <span className="hud-label" style={{ marginTop: 12, color: 'var(--hud-mid)' }}>
            Visuals
          </span>

          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              role="switch"
              aria-checked={postprocessing}
              onClick={() => setPostprocessing(!postprocessing)}
              className={`hud-label hud-option${postprocessing ? ' hud-option--on' : ''}`}
            >
              Bloom
            </button>
            {/* The flare is a composer pass, so it cannot exist without the
                compositor. Disabled with a reason rather than silently inert. */}
            <button
              type="button"
              role="switch"
              aria-checked={lensFlare && postprocessing}
              disabled={!postprocessing}
              onClick={() => setLensFlare(!lensFlare)}
              className={`hud-label hud-option${lensFlare && postprocessing ? ' hud-option--on' : ''}`}
            >
              Lens flare
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
