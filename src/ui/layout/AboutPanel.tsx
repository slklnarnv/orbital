import type { JSX } from 'react'
import type { ReactNode } from 'react'
import { switchOverlay } from '../overlay/overlay'
import { HudPanel } from '../overlay/HudPanel'
import { useOverlay } from '../overlay/useOverlay'

// ─── About: what is real (roadmap 017 P, formerly B.7) ───────────────────────
// Static content. The measured / illustrative split is the honest-instrument
// rule stated in words; the credits follow NOTICE.md (keep the two in step).

const REPO_URL = 'https://github.com/slklnarnv/orbital'

const MEASURED = [
  'Position, speed and altitude: SGP4 from the latest public two-line element set (TLE)',
  'TLE age and confidence: how fresh those elements are',
  'The Sun, the day–night terminator and Earth’s rotation',
  'Sunrise and sunset on the station, penumbra included',
  'The place below, its local time and weather',
  'Visible passes for your location',
]

const ILLUSTRATIVE = [
  'Attitude details: a nominal Earth-facing attitude, not attitude telemetry',
  'Solar array and radiator angles: a tracking law on the same geometry, not joint telemetry',
  'Clouds: a NASA composite, not today’s weather',
  'Lens flare, bloom and the station’s glint',
  'Station size: drawn about 1,000× larger so it stays visible; Earth and distances are to scale',
]

function ExternalLink({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hud-link">
      {children}
    </a>
  )
}

function List({ items }: { items: string[] }): JSX.Element {
  return (
    <ul className="hud-about__list">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  )
}

/**
 * About — a text control beside the wordmark that opens a panel: what is
 * measured and what is illustrative, data sources and credits, the build id,
 * and, first in the panel, ways into the guided tour and the shortcuts.
 */
export function AboutPanel(): JSX.Element {
  const { isOpen, triggerRef, panelRef, onTriggerClick } = useOverlay('about', 'panel')

  return (
    <>
      <button
        ref={triggerRef}
        id="btn-about"
        type="button"
        className="hud-label hud-btn-text"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        data-overlay=""
        onClick={onTriggerClick}
        style={{ color: isOpen ? 'var(--hud-hi)' : undefined }}
      >
        About
      </button>

      {isOpen && (
        <HudPanel title="About Orbital" panelRef={panelRef} className="hud-panel--about">
          {/* First, above the long text: the panel scrolls on short screens,
              and these are what most people open About for. */}
          <div className="hud-about__actions">
            <button type="button" className="hud-label hud-btn-text" onClick={() => switchOverlay('tour')}>
              Take the tour
            </button>
            <button
              type="button"
              className="hud-label hud-btn-text"
              aria-keyshortcuts="?"
              onClick={() => switchOverlay('help')}
            >
              Keyboard shortcuts <kbd className="hud-kbd">?</kbd>
            </button>
          </div>

          <div className="hud-panel__body">
            <p>
              The International Space Station, live: its position is computed in your browser from
              public orbital elements, ten times a second.
            </p>

            <h3 className="hud-label hud-panel__section">Measured</h3>
            <List items={MEASURED} />

            <h3 className="hud-label hud-panel__section">Illustrative</h3>
            <List items={ILLUSTRATIVE} />

            <h3 className="hud-label hud-panel__section">Data and credits</h3>
            <ul className="hud-about__list">
              <li>
                Orbital elements: <ExternalLink href="https://celestrak.org/">CelesTrak</ExternalLink>
                {' '}and <ExternalLink href="https://wheretheiss.at/">wheretheiss.at</ExternalLink>
              </li>
              <li>
                Place names and city search:{' '}
                <ExternalLink href="https://www.naturalearthdata.com/">Natural Earth</ExternalLink> (public domain)
              </li>
              <li>
                Weather and time zones: <ExternalLink href="https://open-meteo.com/">Open-Meteo</ExternalLink> (CC BY 4.0)
              </li>
              <li>ISS model: NASA IGOAL and NASA 3D Resources</li>
              <li>Earth and sky: NASA Blue Marble, Black Marble, a NASA cloud composite and star map</li>
              <li>Type: Space Grotesk by Florian Karsten and Chivo Mono by Omnibus-Type (SIL OFL 1.1)</li>
              <li>Built with three.js, React Three Fiber and satellite.js</li>
            </ul>
            <p className="hud-panel__muted">
              NASA does not endorse this project. Full notices in{' '}
              <ExternalLink href={`${REPO_URL}/blob/main/NOTICE.md`}>NOTICE.md</ExternalLink>; source on{' '}
              <ExternalLink href={REPO_URL}>GitHub</ExternalLink> (MIT).
            </p>
          </div>

          <div className="hud-panel__foot">
            <span className="hud-fine" style={{ color: 'var(--hud-lo)' }}>
              Build {__BUILD_ID__ || '—'}
            </span>
          </div>
        </HudPanel>
      )}
    </>
  )
}
