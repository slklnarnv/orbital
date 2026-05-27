import type { OrbitalState, TLEData } from '@/types/orbital'
import type { SimulationTime } from '@/types/orbital'
import type { OrbitalEntityConfig } from '@/types/orbital'

// ─── OrbitalEntity Interface ──────────────────────────────────────────────────
/**
 * Generic interface for any trackable orbital object.
 * Extend this for ISS, Tiangong, Hubble, etc.
 *
 * Layer 1/2 — no Three.js imports.
 */
export interface OrbitalEntity {
  readonly config: OrbitalEntityConfig

  /** Load a new TLE into this entity's engine */
  loadTLE(tle: TLEData): boolean

  /** Propagate position for the given simulation time */
  propagate(simTime: SimulationTime): OrbitalState | null

  /** Whether this entity has a usable TLE loaded */
  hasTLE(): boolean

  /** Current TLE data (if any) */
  readonly currentTLE: TLEData | null
}
