// ─── passStore.test.ts — observer storage and the recompute policy (B.3) ─────

import { describe, expect, it } from 'vitest'

import { sanitizeObserver } from '@/stores/passStore'
import { PASS_RECOMPUTE_AFTER_MS, needsPassRecompute, observerKeyOf } from '@/core/orbital/PassService'

describe('sanitizeObserver', () => {
  it('keeps a well-formed observer', () => {
    const observer = { label: 'London, United Kingdom', latitudeDeg: 51.5, longitudeDeg: -0.12 }
    expect(sanitizeObserver(observer)).toEqual(observer)
  })

  it('rejects anything malformed from user-editable storage', () => {
    expect(sanitizeObserver(null)).toBeNull()
    expect(sanitizeObserver([])).toBeNull()
    expect(sanitizeObserver({ label: '', latitudeDeg: 0, longitudeDeg: 0 })).toBeNull()
    expect(sanitizeObserver({ label: 'x', latitudeDeg: 91, longitudeDeg: 0 })).toBeNull()
    expect(sanitizeObserver({ label: 'x', latitudeDeg: 0, longitudeDeg: Number.NaN })).toBeNull()
    expect(sanitizeObserver({ label: 'x'.repeat(121), latitudeDeg: 0, longitudeDeg: 0 })).toBeNull()
  })
})

describe('needsPassRecompute', () => {
  const observerKey = observerKeyOf({ latitudeDeg: 51.5, longitudeDeg: -0.12 })
  const previous = { fromMs: 1_000_000, tleKey: 'tle-a', observerKey }

  it('computes the first list', () => {
    expect(needsPassRecompute(null, 0, 'tle-a', observerKey)).toBe(true)
  })

  it('keeps a list while time moves forward inside the window', () => {
    expect(needsPassRecompute(previous, previous.fromMs + 3_600_000, 'tle-a', observerKey)).toBe(false)
    expect(needsPassRecompute(previous, previous.fromMs - 30_000, 'tle-a', observerKey)).toBe(false)
  })

  it('recomputes for a new element set, observer, backward seek or a slid window', () => {
    expect(needsPassRecompute(previous, previous.fromMs, 'tle-b', observerKey)).toBe(true)
    expect(needsPassRecompute(previous, previous.fromMs, 'tle-a', observerKeyOf({ latitudeDeg: 0, longitudeDeg: 0 }))).toBe(true)
    expect(needsPassRecompute(previous, previous.fromMs - 120_000, 'tle-a', observerKey)).toBe(true)
    expect(needsPassRecompute(previous, previous.fromMs + PASS_RECOMPUTE_AFTER_MS + 1, 'tle-a', observerKey)).toBe(true)
  })
})
