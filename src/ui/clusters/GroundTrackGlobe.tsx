import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { sampleGroundTrack } from '@/core/orbital/GroundTrack'
import { issEntity } from '@/core/entities/ISSEntity'
import { useOrbitalState } from '@/hooks/useOrbitalState'
import { useSimulationClock } from '@/hooks/useSimulationClock'
import { useGeoStore } from '@/stores/geoStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { ISS_ORBITAL_PERIOD_MIN } from '@/utils/constants'
import { formatLatitude, formatLongitude } from '@/utils/formatters'

/**
 * GroundTrackGlobe — an orthographic graticule centered on the station's
 * subsatellite point. The grid slides beneath a fixed marker: the view itself
 * is what "follows" the station. Pure SVG, recomputed each 1 Hz telemetry tick.
 *
 * The globe also carries the station's ground track: the path of the
 * subsatellite point, dotted for the half-orbit behind it and solid for the
 * next half-orbit ahead. The track is resampled once per simulated minute.
 *
 * Beneath it, the ground story: the place being overflown (country + continent
 * or ocean/sea), the coordinates, and the local clock with current weather —
 * served by GeoLookupService at its own 5 s cadence.
 *
 * While simulation time is accelerated, place/time/weather are withheld (the
 * lookup service pauses and its last answer would misrepresent a ground
 * point racing at thousands of km/s). The coordinates stay — they are live
 * telemetry and honestly show the race.
 */

const SIZE = 78
const C = SIZE / 2
const R = 31
const TRACK_STEP_MS = 30_000
const TRACK_REFRESH_MS = 60_000

interface Projected {
  x: number
  y: number
  visible: boolean
}

function project(
  phiDeg: number,
  lamDeg: number,
  phi0: number,
  lam0: number
): Projected {
  const phi = (phiDeg * Math.PI) / 180
  const lam = (lamDeg * Math.PI) / 180
  const cosC =
    Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0)
  return {
    x: C + R * Math.cos(phi) * Math.sin(lam - lam0),
    y: C - R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0)),
    visible: cosC >= -0.02,
  }
}

/** Polyline path for one graticule line, broken wherever it rolls off the disk. */
function graticulePath(
  samples: Array<{ phi: number; lam: number }>,
  phi0: number,
  lam0: number
): string {
  let d = ''
  let penDown = false
  for (const { phi, lam } of samples) {
    const p = project(phi, lam, phi0, lam0)
    if (p.visible) {
      d += `${penDown ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)} `
      penDown = true
    } else {
      penDown = false
    }
  }
  return d
}

export function GroundTrackGlobe(): JSX.Element {
  const { latitude, longitude } = useOrbitalState()
  const accelerated = useSimulationStore((state) => state.mode === 'ACCELERATED')
  const simTime = useSimulationClock()

  // Ground track: resample once per simulated minute (or when the TLE changes).
  const trackMinute = Math.floor(simTime.epochMs / TRACK_REFRESH_MS)
  const tleKey = issEntity.currentTLE?.line1 ?? ''
  const trackSamples = useMemo(() => {
    const halfPeriodMs =
      ((issEntity.engine.periodMinutes ?? ISS_ORBITAL_PERIOD_MIN) * 60_000) / 2
    // simTime.epochMs is intentionally read once per trackMinute key, not per tick.
    return sampleGroundTrack(issEntity.engine, simTime.epochMs, {
      pastMs: halfPeriodMs,
      futureMs: halfPeriodMs,
      stepMs: TRACK_STEP_MS,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackMinute, tleKey])

  const { placeName, continent, localTime, tzAbbr, temperatureC, weatherLabel } = useGeoStore(
    useShallow((state) => ({
      placeName: state.placeName,
      continent: state.continent,
      localTime: state.localTime,
      tzAbbr: state.tzAbbr,
      temperatureC: state.temperatureC,
      weatherLabel: state.weatherLabel,
    }))
  )

  const phi0 = (latitude * Math.PI) / 180
  const lam0 = (longitude * Math.PI) / 180

  const gridPaths: string[] = []
  const equatorPaths: string[] = []

  // Parallels every 30° (equator emphasized separately)
  for (let phi = -60; phi <= 60; phi += 30) {
    const samples = Array.from({ length: 73 }, (_, i) => ({
      phi,
      lam: -180 + i * 5,
    }))
    const d = graticulePath(samples, phi0, lam0)
    if (phi === 0) equatorPaths.push(d)
    else gridPaths.push(d)
  }

  // Meridians every 30°
  for (let lam = -180; lam < 180; lam += 30) {
    const samples = Array.from({ length: 37 }, (_, i) => ({
      phi: -90 + i * 5,
      lam,
    }))
    gridPaths.push(graticulePath(samples, phi0, lam0))
  }

  // Ground track: past (dotted) and future (solid) halves around "now".
  const toSamples = (points: typeof trackSamples) =>
    points.map((p) => ({ phi: p.latitude, lam: p.longitude }))
  const pastTrackPath = graticulePath(
    toSamples(trackSamples.filter((p) => p.epochMs <= simTime.epochMs)),
    phi0,
    lam0
  )
  const futureTrackPath = graticulePath(
    toSamples(trackSamples.filter((p) => p.epochMs > simTime.epochMs)),
    phi0,
    lam0
  )

  // Place: country over land (continent as the secondary fact), ocean/sea
  // polygon over water. Unknown stays a quiet em dash — never a guess.
  const placeText = placeName ?? '—'
  const placeTitle = continent !== null ? `${placeName} · ${continent}` : placeName ?? undefined

  const wxSegments: string[] = []
  if (localTime !== null) wxSegments.push(tzAbbr !== null ? `${localTime} ${tzAbbr}` : localTime)
  if (temperatureC !== null) wxSegments.push(`${Math.round(temperatureC)}°C`)
  if (weatherLabel !== null) wxSegments.push(weatherLabel)
  const wxText = wxSegments.length > 0 ? wxSegments.join(' · ') : '—'

  return (
    <div
      className="hud-text"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}
    >
      <div className="hud-bezel" style={{ width: SIZE, height: SIZE }} aria-hidden="true">
        <span className="hud-bezel__ring" />
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={C} cy={C} r={R} fill="rgba(2,4,9,0.35)" stroke="rgba(244,247,251,0.3)" strokeWidth={0.75} />
          {gridPaths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="rgba(244,247,251,0.18)" strokeWidth={0.6} />
          ))}
          {equatorPaths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="rgba(244,247,251,0.3)" strokeWidth={0.7} />
          ))}
          {/* Ground track: dotted behind the station, solid ahead */}
          <path
            d={pastTrackPath}
            fill="none"
            stroke="rgba(244,247,251,0.28)"
            strokeWidth={0.8}
            strokeDasharray="1.5 2"
            strokeLinecap="round"
          />
          <path
            d={futureTrackPath}
            fill="none"
            stroke="rgba(168,216,255,0.75)"
            strokeWidth={0.9}
            strokeLinecap="round"
          />
          {/* Subsatellite marker: fixed at center, the world moves under it */}
          <circle cx={C} cy={C} r={4.2} fill="none" stroke="rgba(244,247,251,0.5)" strokeWidth={0.75} />
          <circle cx={C} cy={C} r={1.9} fill="#f4f7fb" />
        </svg>
      </div>

      <span className="hud-label" style={{ fontSize: 8 }}>
        Passing over
      </span>
      {!accelerated && (
        <span className="hud-place" title={placeTitle}>
          {placeText}
        </span>
      )}
      <span className="hud-fine hud-groundcoords" style={{ whiteSpace: 'nowrap' }}>
        {formatLatitude(latitude, 2)} · {formatLongitude(longitude, 2)}
      </span>
      {!accelerated && (
        <span className="hud-fine hud-groundwx" style={{ whiteSpace: 'nowrap', color: 'var(--hud-lo)' }}>
          {wxText}
        </span>
      )}
    </div>
  )
}
