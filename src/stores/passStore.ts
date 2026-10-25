import { create } from 'zustand'
import { issEntity } from '@/core/entities/ISSEntity'
import type { VisiblePass } from '@/core/orbital/PassPredictor'
import { needsPassRecompute, observerKeyOf, passService, type PassComputeKey } from '@/core/orbital/PassService'

// ─── Visible passes (roadmap B.3) ────────────────────────────────────────────
//
// The observer is kept in localStorage only — it is never sent anywhere —
// and validated on read, since storage is user-editable.

export interface ObserverLocation {
  /** What the panel shows: "London, United Kingdom", "My location", or coordinates. */
  label: string
  latitudeDeg: number
  longitudeDeg: number
}

export type PassStatus = 'idle' | 'computing' | 'ready' | 'error'

const STORAGE_KEY = 'orbital-observer'

/** Keeps only a well-formed observer (exported for tests). */
export function sanitizeObserver(value: unknown): ObserverLocation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const { label, latitudeDeg, longitudeDeg } = raw
  if (typeof label !== 'string' || label.length === 0 || label.length > 120) return null
  if (typeof latitudeDeg !== 'number' || !Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) > 90) return null
  if (typeof longitudeDeg !== 'number' || !Number.isFinite(longitudeDeg) || Math.abs(longitudeDeg) > 180) return null
  return { label, latitudeDeg, longitudeDeg }
}

function readStoredObserver(): ObserverLocation | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeObserver(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeStoredObserver(observer: ObserverLocation | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (observer) localStorage.setItem(STORAGE_KEY, JSON.stringify(observer))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private mode, quota): the observer lasts the session.
  }
}

interface PassStore {
  observer: ObserverLocation | null
  status: PassStatus
  passes: VisiblePass[]
  computed: PassComputeKey | null
  setObserver: (observer: ObserverLocation | null) => void
  /** Recompute if the list is stale at simulation time `simMs`. */
  refresh: (simMs: number) => void
}

let requestSerial = 0

export const usePassStore = create<PassStore>((set, get) => ({
  observer: readStoredObserver(),
  status: 'idle',
  passes: [],
  computed: null,

  setObserver: (observer) => {
    writeStoredObserver(observer)
    set({ observer, passes: [], computed: null, status: 'idle' })
  },

  refresh: (simMs) => {
    const { observer, computed } = get()
    const tle = issEntity.currentTLE
    if (!observer || !tle) return
    const tleKey = tle.line1 + tle.line2
    const observerKey = observerKeyOf(observer)
    if (!needsPassRecompute(computed, simMs, tleKey, observerKey)) return

    const serial = ++requestSerial
    const key: PassComputeKey = { fromMs: simMs, tleKey, observerKey }
    set({ status: 'computing', computed: key })
    passService.compute(tle.line1, tle.line2, observer, simMs).then(
      (passes) => {
        if (serial === requestSerial) set({ passes, status: 'ready' })
      },
      () => {
        if (serial === requestSerial) set({ passes: [], status: 'error' })
      },
    )
  },
}))
