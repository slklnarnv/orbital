import { OrbitalEngine } from '../orbital/OrbitalEngine'
import type { OrbitalEntity } from './OrbitalEntity'
import type { OrbitalState, TLEData, SimulationTime, OrbitalEntityConfig } from '@/types/orbital'
import { ISS_NORAD_ID } from '@/utils/constants'
import fallbackTLE from '@/data/fallback-tle.json'

// ─── ISS Entity ───────────────────────────────────────────────────────────────
/**
 * Concrete OrbitalEntity implementation for the International Space Station.
 * Bootstraps with the hardcoded fallback TLE on construction.
 */
export class ISSEntity implements OrbitalEntity {
  readonly config: OrbitalEntityConfig = {
    id: 'iss',
    name: 'International Space Station',
    noradId: ISS_NORAD_ID,
    orbitColor: '#93C5FD',
  }

  private _engine = new OrbitalEngine('iss')

  constructor() {
    this._loadFallbackTLE()
  }

  private _loadFallbackTLE(): void {
    // Construct proper TLE string from stored lines
    const tle: TLEData = {
      line1: fallbackTLE.line1,
      line2: fallbackTLE.line2,
      fetchedAt: new Date(fallbackTLE.epoch).getTime(),
      source: 'fallback',
    }
    this._engine.loadTLE(tle)
  }

  loadTLE(tle: TLEData): boolean {
    return this._engine.loadTLE(tle)
  }

  propagate(simTime: SimulationTime): OrbitalState | null {
    return this._engine.propagate(simTime)
  }

  hasTLE(): boolean {
    return this._engine.hasTLE()
  }

  get currentTLE(): TLEData | null {
    return this._engine.currentTLE
  }

  /** Access internal engine for orbit path generation */
  get engine(): OrbitalEngine {
    return this._engine
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const issEntity = new ISSEntity()
