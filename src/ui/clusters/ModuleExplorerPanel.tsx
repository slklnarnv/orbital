import { useMemo, type KeyboardEvent } from 'react'
import { ISS_MODULES, formatModuleMass } from '@/data/issModules'
import { moduleById } from '@/rendering/iss/moduleExplorer'
import { useExplorerStore } from '@/stores/explorerStore'

/**
 * ModuleExplorerPanel — the module explorer's info card (plan 017 X1),
 * parked on the left edge while it is open. Its control is Modules in the
 * top-right tool row (ModulesButton). Picking happens in the scene
 * (ModuleExplorerLayer); the module list here is the keyboard path to the
 * same selection.
 */
export function ModuleExplorerPanel(): JSX.Element | null {
  const availability = useExplorerStore((state) => state.availability)
  const open = useExplorerStore((state) => state.open)
  const hoveredId = useExplorerStore((state) => state.hoveredId)
  const selectedId = useExplorerStore((state) => state.selectedId)
  const focused = useExplorerStore((state) => state.focused)
  const exploded = useExplorerStore((state) => state.exploded)
  const { setOpen, select, setFocused, setExploded } = useExplorerStore.getState()
  const sorted = useMemo(() => [...ISS_MODULES].sort((a, b) => a.name.localeCompare(b.name)), [])

  if (availability === 'hidden' || !open) return null

  const selected = moduleById(selectedId)
  const hovered = hoveredId !== selectedId ? moduleById(hoveredId) : null
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (selectedId) select(null)
    else setOpen(false)
  }

  return (
    <div className="hud-explorer hud-text">
      <section
        className="hud-explorer__panel"
        aria-label="Module explorer"
        onKeyDown={onKeyDown}
      >
        <div className="hud-explorer__head">
          <span className="hud-label" style={{ color: 'var(--hud-hi)' }}>Module explorer</span>
          <button type="button" className="hud-label hud-btn-text" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>

        {availability === 'unavailable' ? (
          <p className="hud-fine hud-explorer__note" role="status">
            Not available on this model.
          </p>
        ) : (
          <>
            <div className="hud-explorer__row">
              <button
                type="button"
                className={`hud-option hud-option--compact hud-label${exploded ? ' hud-option--on' : ''}`}
                aria-pressed={exploded}
                onClick={() => setExploded(!exploded)}
              >
                {exploded ? 'Assemble' : 'Explode'}
              </button>
              <select
                className="hud-input hud-explorer__select"
                aria-label="Choose a module"
                value={selectedId ?? ''}
                onChange={(event) => select(event.target.value || null)}
              >
                <option value="">Choose a module…</option>
                {sorted.map((module) => (
                  <option key={module.id} value={module.id}>{module.name}</option>
                ))}
              </select>
            </div>

            <p className="hud-fine hud-explorer__note" aria-live="polite">
              {hovered ? hovered.name : selected ? ' ' : 'Point at the station and click a module.'}
            </p>

            {selected && (
              <article className="hud-explorer__card" aria-label={selected.name}>
                <h2 className="hud-num hud-explorer__title">{selected.name}</h2>
                <p className="hud-label">
                  {selected.agency}
                  <span style={{ color: 'var(--hud-lo)' }}>{'  ·  '}</span>
                  {`Launched ${selected.launchYear}`}
                </p>
                <dl className="hud-explorer__facts">
                  <dt className="hud-label">Mass</dt>
                  <dd className="hud-fine">
                    {formatModuleMass(selected.massLb)}
                    {selected.massNote && selected.massLb !== null ? ` (${selected.massNote})` : ''}
                  </dd>
                  {selected.builtBy && (
                    <>
                      <dt className="hud-label">Built by</dt>
                      <dd className="hud-fine">{selected.builtBy}</dd>
                    </>
                  )}
                  {selected.launchNote && (
                    <>
                      <dt className="hud-label">History</dt>
                      <dd className="hud-fine">{selected.launchNote}</dd>
                    </>
                  )}
                </dl>
                <p className="hud-explorer__purpose">{selected.purpose}</p>
                <div className="hud-explorer__row">
                  <button
                    type="button"
                    className={`hud-option hud-option--compact hud-label${focused ? ' hud-option--on' : ''}`}
                    aria-pressed={focused}
                    onClick={() => setFocused(!focused)}
                  >
                    {focused ? 'Release camera' : 'Focus camera'}
                  </button>
                  <button type="button" className="hud-label hud-btn-text" onClick={() => select(null)}>
                    Clear
                  </button>
                </div>
              </article>
            )}
            <p className="hud-fine hud-explorer__source">Facts: NASA station assembly elements</p>
          </>
        )}
      </section>
    </div>
  )
}
