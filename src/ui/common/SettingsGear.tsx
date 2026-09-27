import { useEffect, useRef, useState } from 'react'
import { useSettingsStore, type IssModelQuality } from '@/stores/settingsStore'

const MODEL_OPTIONS: Array<{ value: IssModelQuality; label: string; hint: string }> = [
  { value: 'high', label: 'High fidelity', hint: 'IGOAL · animated' },
  { value: 'legacy', label: 'Legacy', hint: 'Performance · static' },
]

/**
 * SettingsGear — discreet render-settings access, parked in the top-right
 * corner cluster. Deliberately minimal: a gear that opens a small popover
 * with the ISS model selection. Nothing else lives here (yet), so the
 * standard orbital-visualization experience stays unobscured.
 */
export function SettingsGear(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const issModelQuality = useSettingsStore((state) => state.issModelQuality)
  const setIssModelQuality = useSettingsStore((state) => state.setIssModelQuality)

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false)
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

          <div role="radiogroup" aria-label="ISS model" style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            {MODEL_OPTIONS.map((option) => {
              const isSelected = issModelQuality === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setIssModelQuality(option.value)}
                  className="hud-label"
                  style={{
                    appearance: 'none',
                    textAlign: 'left',
                    background: 'transparent',
                    border: '1px solid',
                    borderColor: isSelected ? 'var(--hud-hi)' : 'var(--hud-line)',
                    color: isSelected ? 'var(--hud-hi)' : 'var(--hud-mid)',
                    padding: '7px 10px',
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                  <span
                    className="hud-fine"
                    style={{ display: 'block', marginTop: 3, color: 'var(--hud-lo)', fontSize: 9 }}
                  >
                    {option.hint}
                  </span>
                </button>
              )
            })}
          </div>

        </div>
      )}
    </div>
  )
}
