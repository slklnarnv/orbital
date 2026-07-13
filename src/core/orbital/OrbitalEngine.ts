import * as satellite from 'satellite.js'
import type { TLEData, OrbitalState, SimulationTime } from '@/types/orbital'
import {
  temeToGeodetic,
} from './CoordinateConversions'
import { getTLEAgeHours, tleConfidence, extractTLEEpoch } from './TLEParser'
import { vec3Length } from '@/utils/math'

// ─── Orbital Engine ───────────────────────────────────────────────────────────
/**
 * Wraps satellite.js SGP4 propagation.
 * Input:  TLEData + SimulationTime
 * Output: OrbitalState (pure data, no Three.js)
 *
 * Layer 2 — no Three.js imports.
 */
export class OrbitalEngine {
  private _entityId: string
  private _tle: TLEData | null = null
  private _satrec: satellite.SatRec | null = null
  /** Cached TLE epoch in milliseconds (parsed once at loadTLE() to avoid per-propagation string parsing) */
  private _cachedEpochMs: number | null = null

  constructor(entityId: string) {
    this._entityId = entityId
  }

  // ── TLE Management ─────────────────────────────────────────────────────────

  loadTLE(tle: TLEData): boolean {
    try {
      const satrec = satellite.twoline2satrec(tle.line1, tle.line2)
      if (satrec.error !== 0) {
        console.error(`[OrbitalEngine:${this._entityId}] TLE parse error:`, satrec.error)
        return false
      }
      this._tle = tle
      this._satrec = satrec
      // F-06 FIX: Cache the TLE epoch at load time to avoid re-parsing the string on
      // every call to propagate() (~60×/s at 60 fps). Each parse does a substring +
      // parseInt + parseFloat + Date construction per frame, wasting ~1 μs per frame.
      this._cachedEpochMs = extractTLEEpoch(tle.line1).getTime()
      return true
    } catch (err) {
      console.error(`[OrbitalEngine:${this._entityId}] Failed to load TLE:`, err)
      return false
    }
  }

  clearTLE(): void {
    this._tle = null
    this._satrec = null
    this._cachedEpochMs = null
  }

  hasTLE(): boolean {
    return this._satrec !== null && this._tle !== null
  }

  get currentTLE(): TLEData | null {
    return this._tle
  }

  // ── Propagation ────────────────────────────────────────────────────────────

  /**
   * Propagate orbital position for the given simulation time.
   * Returns null if no TLE loaded or propagation fails.
   */
  propagate(simTime: SimulationTime): OrbitalState | null {
    if (!this._satrec || !this._tle) return null

    const date = new Date(simTime.epochMs)

    // SGP4 propagation — output in TEME frame (km, km/s)
    const result = satellite.propagate(this._satrec, date)

    if (!result.position || typeof result.position === 'boolean') {
      console.warn(`[OrbitalEngine:${this._entityId}] Propagation failed at`, date)
      return null
    }

    const posTEME = result.position as { x: number; y: number; z: number }
    const velTEME = result.velocity as { x: number; y: number; z: number }

    // Convert to geodetic for telemetry display
    const geodetic = temeToGeodetic(posTEME, simTime.gmst)

    // Speed magnitude
    const speed = vec3Length(velTEME)

    // Orbital period from TLE mean motion (rev/day)
    // mean motion is in revolutions per minute in satellite.js satrec
    const meanMotionRadPerMin = this._satrec.no // radians/min
    const orbitalPeriod = (2 * Math.PI / meanMotionRadPerMin) // minutes

    // F-06: Use cached epoch for age calculation (avoids per-propagation string parsing)
    const tleAgeHours = this._cachedEpochMs !== null
      ? (simTime.epochMs - this._cachedEpochMs) / (1000 * 3600)
      : getTLEAgeHours(this._tle, simTime.epochMs)
    const confidence = tleConfidence(tleAgeHours)

    return {
      entityId: this._entityId,
      timestamp: simTime.epochMs,
      positionECI: posTEME,
      velocityECI: velTEME,
      latitude: geodetic.latitude,
      longitude: geodetic.longitude,
      altitude: geodetic.altitude,
      speed,
      orbitalPeriod,
      inclination: this._satrec.inclo * (180 / Math.PI), // convert rad to deg
      // N-5 FIX: Correctly map TLE source to OrbitalState source.
      // Previously 'celestrak' was mapped to 'cached' (same as IndexedDB-cached TLEs),
      // obscuring which data came from the network vs. the local cache.
      source: this._tle.source === 'fallback' ? 'propagated'
            : this._tle.source === 'celestrak' ? 'live'
            : 'cached',
      tleAgeHours,
      confidence,
    }
  }

  /**
   * Propagate position at an arbitrary future/past time offset.
   * Used for orbit path generation — does not affect current state.
   */
  propagateAt(epochMs: number): { x: number; y: number; z: number } | null {
    if (!this._satrec) return null

    const date = new Date(epochMs)
    const result = satellite.propagate(this._satrec, date)

    if (!result.position || typeof result.position === 'boolean') return null
    return result.position as { x: number; y: number; z: number }
  }
}
