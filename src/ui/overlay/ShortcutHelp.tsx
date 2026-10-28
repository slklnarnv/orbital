import type { JSX } from 'react'
import { LOCAL_KEYS, SHORTCUTS, type Shortcut } from '../shortcuts/shortcutRegistry'
import { HudPanel } from './HudPanel'
import { switchOverlay } from './overlay'
import { useOverlay } from './useOverlay'

const GROUPS: Array<Shortcut['group']> = ['Time', 'View', 'Panels']

function Keys({ keys }: { keys: string[] }): JSX.Element {
  return (
    <dt className="hud-keys__keys">
      {keys.map((key) => (
        <kbd key={key} className="hud-kbd">{key}</kbd>
      ))}
    </dt>
  )
}

/**
 * The `?` overlay: every global shortcut, read straight from the registry so
 * the list cannot drift from the keys, plus the keys individual controls
 * own. Modal — the other shortcuts pause while it is open.
 */
export function ShortcutHelp(): JSX.Element | null {
  const { isOpen, panelRef } = useOverlay('help', 'panel')
  if (!isOpen) return null

  return (
    <>
      <div aria-hidden="true" className="hud-panel-backdrop" />
      <HudPanel title="Keyboard shortcuts" panelRef={panelRef} className="hud-panel--help" modal>
        <div className="hud-help__groups">
          {GROUPS.map((group) => (
            <section key={group} className="hud-help__group">
              <h3 className="hud-label hud-panel__section">{group}</h3>
              <dl className="hud-keys">
                {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                  <div key={shortcut.id} className="hud-keys__row">
                    <Keys keys={shortcut.keys} />
                    <dd>{shortcut.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section className="hud-help__group">
            <h3 className="hud-label hud-panel__section">On a control</h3>
            <dl className="hud-keys">
              {LOCAL_KEYS.map((entry) => (
                <div key={entry.label} className="hud-keys__row">
                  <Keys keys={entry.keys} />
                  <dd>{entry.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <div className="hud-panel__foot">
          <p className="hud-fine" style={{ color: 'var(--hud-lo)', lineHeight: 1.5 }}>
            Shortcuts pause while you type in a field, and never take Ctrl, Alt or Cmd combinations.
          </p>
          <button type="button" className="hud-label hud-btn-text" onClick={() => switchOverlay('tour')}>
            Take the tour
          </button>
        </div>
      </HudPanel>
    </>
  )
}
