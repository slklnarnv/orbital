import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useSimulationClock } from '@/hooks/useSimulationClock'
import { usePassStore, type ObserverLocation } from '@/stores/passStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { compassPoint, type VisiblePass } from '@/core/orbital/PassPredictor'
import { parseCoordinates, type City, type CityIndex } from '@/core/geo/CitySearch'
import { loadCityIndex } from '@/core/geo/cityIndexLoader'
import { formatLatitude, formatLongitude } from '@/utils/formatters'
import { closeOverlay } from '../overlay/overlay'
import { useOverlay } from '../overlay/useOverlay'
import { ToolIcon } from './ToolIcon'

// ─── Visible passes (roadmap B.3) ────────────────────────────────────────────
// A "Passes" control in the top-right tool row (Passes, Modules, Settings). The popover sets the observer — a city from the offline index,
// typed coordinates, or the browser's location — and lists the next visible
// passes over 48 h of simulation time. "Watch" seeks to just before a pass
// and plays it at 1×.

const MAX_LISTED = 6
const WATCH_LEAD_MS = 30_000

interface Suggestion {
  key: string
  label: string
  detail: string
  observer: ObserverLocation
}

function coordinateLabel(latitudeDeg: number, longitudeDeg: number): string {
  return `${formatLatitude(latitudeDeg, 2)}, ${formatLongitude(longitudeDeg, 2)}`
}

function citySuggestion(city: City): Suggestion {
  const where = [city.region, city.country].filter(Boolean).join(', ')
  return {
    key: `${city.name}|${city.latitudeDeg}|${city.longitudeDeg}`,
    label: city.name,
    detail: where,
    observer: { label: `${city.name}, ${city.country}`, latitudeDeg: city.latitudeDeg, longitudeDeg: city.longitudeDeg },
  }
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function timeZoneLabel(epochMs: number): string {
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date(epochMs))
      .find((p) => p.type === 'timeZoneName')
    return part?.value ?? 'local time'
  } catch {
    return 'local time'
  }
}

/** "now", "in 12 min", "in 3 h 05 min". */
export function formatPassLead(pass: VisiblePass, simMs: number): string {
  if (simMs >= pass.start.epochMs) return 'now'
  const minutes = Math.max(1, Math.round((pass.start.epochMs - simMs) / 60_000))
  if (minutes < 60) return `in ${minutes} min`
  return `in ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

/** "3 min 20 s" for the visible duration. */
export function formatPassDuration(pass: VisiblePass): string {
  const seconds = Math.max(0, Math.round((pass.end.epochMs - pass.start.epochMs) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`
}

function ObserverPicker({ onPicked }: { onPicked: () => void }): JSX.Element {
  const setObserver = usePassStore((state) => state.setObserver)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<CityIndex | null>(null)
  const [indexState, setIndexState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [active, setActive] = useState(0)
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied' | 'unavailable'>('idle')
  const listId = useId()

  useEffect(() => {
    if (index || indexState !== 'idle' || query.trim().length < 2) return
    setIndexState('loading')
    loadCityIndex().then(
      (loaded) => { setIndex(loaded); setIndexState('idle') },
      () => setIndexState('failed'),
    )
  }, [query, index, indexState])

  const suggestions = useMemo<Suggestion[]>(() => {
    const coordinates = parseCoordinates(query)
    if (coordinates) {
      const label = coordinateLabel(coordinates.latitudeDeg, coordinates.longitudeDeg)
      return [{ key: 'coordinates', label, detail: 'Coordinates', observer: { label: 'Custom location', ...coordinates } }]
    }
    if (!index || query.trim().length < 2) return []
    return index.search(query, 6).map(citySuggestion)
  }, [query, index])

  useEffect(() => setActive(0), [suggestions])

  const pick = (suggestion: Suggestion): void => {
    setObserver(suggestion.observer)
    onPicked()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault()
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter' && suggestions[active]) {
      event.preventDefault()
      pick(suggestions[active])
    }
  }

  const useMyLocation = (): void => {
    if (!('geolocation' in navigator)) {
      setGeoState('unavailable')
      return
    }
    setGeoState('locating')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoState('idle')
        setObserver({ label: 'My location', latitudeDeg: position.coords.latitude, longitudeDeg: position.coords.longitude })
        onPicked()
      },
      (error) => setGeoState(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { timeout: 10_000, maximumAge: 10 * 60_000 },
    )
  }

  const searchHint = indexState === 'loading' ? 'Loading places…'
    : indexState === 'failed' ? 'Place search unavailable — type coordinates'
      : query.trim().length >= 2 && suggestions.length === 0 && index ? 'No match'
        : 'City, or latitude and longitude'

  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
      <input
        type="text"
        role="combobox"
        aria-label="Observer location"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-activedescendant={suggestions[active] ? `${listId}-${active}` : undefined}
        placeholder="Search a city"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        className="hud-input"
        autoFocus
      />
      {suggestions.length > 0 ? (
        <ul id={listId} role="listbox" aria-label="Matching places" className="hud-suggestions">
          {suggestions.map((suggestion, i) => (
            <li
              key={suggestion.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`hud-suggestion${i === active ? ' hud-suggestion--active' : ''}`}
              onMouseDown={(event) => { event.preventDefault(); pick(suggestion) }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="hud-label" style={{ color: 'inherit' }}>{suggestion.label}</span>
              <span className="hud-fine" style={{ color: 'var(--hud-lo)', fontSize: 9 }}>{suggestion.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="hud-fine" style={{ color: 'var(--hud-lo)', fontSize: 9 }}>{searchHint}</span>
      )}
      <button type="button" className="hud-label hud-option" onClick={useMyLocation} disabled={geoState === 'locating'}>
        {geoState === 'locating' ? 'Locating…' : 'Use my location'}
      </button>
      {(geoState === 'denied' || geoState === 'unavailable') && (
        <span className="hud-fine" style={{ color: 'var(--hud-lo)', fontSize: 9 }}>
          {geoState === 'denied' ? 'Location permission denied' : 'Location unavailable'}
        </span>
      )}
    </div>
  )
}

function PassRow({ pass, simMs, onWatch }: { pass: VisiblePass; simMs: number; onWatch: () => void }): JSX.Element {
  const start = new Date(pass.start.epochMs)
  const path = `${compassPoint(pass.start.azimuthDeg)} → ${compassPoint(pass.end.azimuthDeg)}`
  return (
    <li className="hud-pass">
      <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        <span className="hud-label" style={{ color: 'var(--hud-hi)' }}>
          {dayFormat.format(start)} · {timeFormat.format(start)}
          <span className="hud-fine" style={{ color: 'var(--hud-lo)', marginLeft: 6 }}>{formatPassLead(pass, simMs)}</span>
        </span>
        <span className="hud-fine" style={{ fontSize: 9 }}>
          {formatPassDuration(pass)} · max {Math.round(pass.peak.elevationDeg)}° · {path}
          {pass.endsInShadow ? ' · fades into shadow' : ''}
        </span>
      </div>
      <button type="button" className="hud-label hud-option hud-option--compact" onClick={onWatch}>
        Watch
      </button>
    </li>
  )
}

function PassList({ onWatched }: { onWatched: () => void }): JSX.Element {
  const simTime = useSimulationClock(1000)
  const { observer, status, passes, refresh } = usePassStore()

  useEffect(() => {
    refresh(simTime.epochMs)
  }, [simTime.epochMs, observer, refresh])

  const upcoming = passes.filter((pass) => pass.end.epochMs > simTime.epochMs).slice(0, MAX_LISTED)
  const watch = (pass: VisiblePass): void => {
    const simulation = useSimulationStore.getState()
    simulation.seek(Math.max(pass.start.epochMs - WATCH_LEAD_MS, simTime.epochMs))
    simulation.setRate(1)
    onWatched()
  }

  if (status === 'computing' && upcoming.length === 0) {
    return <span className="hud-fine" style={{ color: 'var(--hud-lo)', marginTop: 8 }}>Computing passes…</span>
  }
  if (status === 'error') {
    return <span className="hud-fine" style={{ color: 'var(--hud-lo)', marginTop: 8 }}>Prediction unavailable</span>
  }
  if (upcoming.length === 0) {
    return <span className="hud-fine" style={{ color: 'var(--hud-lo)', marginTop: 8 }}>No visible passes in the next 48 hours</span>
  }
  return (
    <ul className="hud-pass-list" aria-label="Upcoming visible passes">
      {upcoming.map((pass) => (
        <PassRow key={pass.start.epochMs} pass={pass} simMs={simTime.epochMs} onWatch={() => watch(pass)} />
      ))}
    </ul>
  )
}

export function PassesPanel(): JSX.Element {
  // Shared overlay system (ui/overlay/overlay.ts): `P` toggles it, Escape
  // closes it — also from the place search — and focus returns here.
  const { isOpen, triggerRef, panelRef, onTriggerClick } = useOverlay('passes')
  const [editing, setEditing] = useState(false)
  const observer = usePassStore((state) => state.observer)

  // Every open starts on the pass list, however the panel was opened.
  useEffect(() => {
    if (!isOpen) setEditing(false)
  }, [isOpen])

  const picking = editing || observer === null

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        ref={triggerRef}
        id="btn-passes"
        type="button"
        aria-label="Visible passes"
        aria-expanded={isOpen}
        aria-keyshortcuts="P"
        data-overlay=""
        onClick={onTriggerClick}
        className="hud-label hud-btn-text hud-tool"
        style={{ color: isOpen ? 'var(--hud-hi)' : undefined }}
      >
        <ToolIcon name="passes" />
        <span className="hud-tool__label">Passes</span>
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Visible passes"
          className="hud-settings-popover hud-passes-popover hud-text"
          data-overlay=""
        >
          <span className="hud-fine" style={{ color: 'var(--hud-lo)', letterSpacing: '0.18em' }}>
            Visible passes
          </span>

          <span className="hud-label" style={{ marginTop: 10, color: 'var(--hud-mid)' }}>Observer</span>
          {picking || !observer ? (
            <ObserverPicker onPicked={() => setEditing(false)} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 6 }}>
              <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <span className="hud-label" style={{ color: 'var(--hud-hi)' }}>{observer.label}</span>
                <span className="hud-fine" style={{ color: 'var(--hud-lo)', fontSize: 9 }}>
                  {coordinateLabel(observer.latitudeDeg, observer.longitudeDeg)}
                </span>
              </span>
              <button type="button" className="hud-label hud-btn-text" onClick={() => setEditing(true)}>
                Change
              </button>
            </div>
          )}

          {observer && !picking && (
            <>
              <span className="hud-label" style={{ marginTop: 12, color: 'var(--hud-mid)' }}>Next 48 hours</span>
              <PassList onWatched={() => closeOverlay()} />
            </>
          )}

          <span className="hud-fine hud-passes-note">
            Visible when the ISS is sunlit, above 10° and your sky is dark (Sun below −6°).
            Times in {timeZoneLabel(Date.now())}. Your location stays on this device.
          </span>
        </div>
      )}
    </div>
  )
}
