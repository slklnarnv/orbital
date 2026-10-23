// ─── ISSModelLifecycle.test.ts — Phase E selection lifecycle contracts ───────
//
// Real store transitions with controlled attempt completions (plan 001 §6):
//   - attempt identity: an obsolete preparation cannot resolve the current
//     attempt (stale commit/fail are ignored);
//   - the committed (active) quality survives a pending replacement and is
//     swapped only when the new candidate commits;
//   - explicit re-selection bumps the selection nonce even when the preferred
//     value is unchanged (R3: reselecting High clears a demotion);
//   - 'unavailable' (Model A failed) is terminal and distinct from 'failed'
//     (usable-A), which requestISSDetail may retry.
//
// React error-boundary latching and GPU visibility are browser-matrix
// concerns and are deliberately not claimed here.

import { afterEach, describe, expect, it } from 'vitest'

import { useLoadingStore, hasCommittedDetail, shouldAwaitDetail } from '@/stores/loadingStore'
import { useSettingsStore } from '@/stores/settingsStore'

afterEach(() => {
  useLoadingStore.setState(useLoadingStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

describe('attempt identity', () => {
  it('an obsolete preparation cannot resolve the current attempt', () => {
    const store = useLoadingStore.getState()
    const staleAttempt = store.beginISSDetailAttempt('high')

    // A new selection starts a fresh attempt for a different candidate...
    const currentAttempt = useLoadingStore.getState().beginISSDetailAttempt('legacy')
    expect(currentAttempt).toBe(staleAttempt + 1)
    expect(useLoadingStore.getState().issDetail.status).toBe('loading')

    // ...so the obsolete preparation's completion must be inert.
    useLoadingStore.getState().commitISSDetailReady(staleAttempt)
    expect(useLoadingStore.getState().issDetail.status).toBe('loading')

    useLoadingStore.getState().failISSDetailAttempt(staleAttempt)
    expect(useLoadingStore.getState().issDetail.status).toBe('loading')

    // While the current attempt still resolves normally.
    useLoadingStore.getState().commitISSDetailReady(currentAttempt)
    expect(useLoadingStore.getState().issDetail.status).toBe('ready')
  })

  it('commit adopts the quality of its own attempt, not whichever is requested later', () => {
    const store = useLoadingStore.getState()
    const highAttempt = store.beginISSDetailAttempt('high')
    useLoadingStore.getState().commitISSDetailReady(highAttempt)
    expect(useLoadingStore.getState().issDetail.activeQuality).toBe('high')

    useLoadingStore.getState().beginISSDetailAttempt('legacy')
    useLoadingStore.getState().commitISSDetailReady(useLoadingStore.getState().issDetail.attempt)
    expect(useLoadingStore.getState().issDetail.activeQuality).toBe('legacy')
  })
})

describe('committed model survives a pending replacement (E.4)', () => {
  it('keeps activeQuality while a different candidate loads/prepares', () => {
    const store = useLoadingStore.getState()
    const readyAttempt = store.beginISSDetailAttempt('high')
    store.commitISSDetailReady(readyAttempt)
    expect(useLoadingStore.getState().issDetail.activeQuality).toBe('high')

    // Selection starts a legacy candidate: the committed high model must stay
    // owned by activeQuality through loading and preparing...
    const legacyAttempt = store.beginISSDetailAttempt('legacy')
    expect(useLoadingStore.getState().issDetail).toMatchObject({
      status: 'loading',
      quality: 'legacy',
      activeQuality: 'high',
    })
    store.setIssDetailPreparing(legacyAttempt)
    expect(useLoadingStore.getState().issDetail.activeQuality).toBe('high')

    // ...and swaps only when the new candidate commits.
    store.commitISSDetailReady(legacyAttempt)
    expect(useLoadingStore.getState().issDetail.activeQuality).toBe('legacy')
  })

  it('keeps activeQuality when the replacement fails (usable fallback stays shown)', () => {
    const store = useLoadingStore.getState()
    const readyAttempt = store.beginISSDetailAttempt('high')
    store.commitISSDetailReady(readyAttempt)

    const legacyAttempt = store.beginISSDetailAttempt('legacy')
    store.failISSDetailAttempt(legacyAttempt)
    expect(useLoadingStore.getState().issDetail).toMatchObject({
      status: 'failed',
      activeQuality: 'high',
    })
  })
})

describe('selection nonce (R3)', () => {
  it('bumps even when the preferred value is unchanged, so reselection is observable', () => {
    const before = useSettingsStore.getState().selectionNonce
    useSettingsStore.getState().setIssModelQuality('high')
    expect(useSettingsStore.getState().selectionNonce).toBe(before + 1)
    useSettingsStore.getState().setIssModelQuality('high')
    expect(useSettingsStore.getState().selectionNonce).toBe(before + 2)
    // The selection itself still round-trips.
    expect(useSettingsStore.getState().issModelQuality).toBe('high')
  })
})

describe('two-tier high detail (Locate LOD -> full high)', () => {
  it('commits the Locate LOD first, then the full high model on Inspect', () => {
    const locateAttempt = useLoadingStore.getState().beginISSDetailAttempt('locate')
    useLoadingStore.getState().setIssDetailPreparing(locateAttempt)
    useLoadingStore.getState().commitISSDetailReady(locateAttempt)
    expect(useLoadingStore.getState().issDetail).toMatchObject({
      status: 'ready',
      quality: 'locate',
      activeQuality: 'locate',
    })

    const highAttempt = useLoadingStore.getState().beginISSDetailAttempt('high')
    // The committed LOD stays the displayed model while the full asset loads.
    expect(useLoadingStore.getState().issDetail).toMatchObject({
      status: 'loading',
      quality: 'high',
      activeQuality: 'locate',
    })
    useLoadingStore.getState().commitISSDetailReady(highAttempt)
    expect(useLoadingStore.getState().issDetail).toMatchObject({
      status: 'ready',
      quality: 'high',
      activeQuality: 'high',
    })
  })

  it('keeps the committed Locate LOD when the full high attempt fails', () => {
    const locateAttempt = useLoadingStore.getState().beginISSDetailAttempt('locate')
    useLoadingStore.getState().commitISSDetailReady(locateAttempt)
    const highAttempt = useLoadingStore.getState().beginISSDetailAttempt('high')
    useLoadingStore.getState().failISSDetailAttempt(highAttempt)
    expect(useLoadingStore.getState().issDetail).toMatchObject({
      status: 'failed',
      quality: 'high',
      activeQuality: 'locate',
    })
  })

  it('a hover/Locate-intent request cannot start a higher tier once a detail is committed', () => {
    const locateAttempt = useLoadingStore.getState().beginISSDetailAttempt('locate')
    useLoadingStore.getState().commitISSDetailReady(locateAttempt)
    const before = useLoadingStore.getState().issDetail
    useLoadingStore.getState().requestISSDetail()
    expect(useLoadingStore.getState().issDetail).toEqual(before)
  })
})

describe('Locate departure gate', () => {
  const base = { quality: null, activeQuality: null, attempt: 0 } as const

  it('waits for the first usable tier while no detailed model is committed', () => {
    for (const status of ['idle', 'loading', 'preparing'] as const) {
      const detail = { ...base, status }
      expect(hasCommittedDetail(detail)).toBe(false)
      expect(shouldAwaitDetail(detail)).toBe(true)
    }
  })

  it('departs on any committed tier, even while a higher tier is loading', () => {
    const loadingHigh = {
      status: 'loading' as const,
      quality: 'high' as const,
      activeQuality: 'locate' as const,
      attempt: 3,
    }
    expect(hasCommittedDetail(loadingHigh)).toBe(true)
    expect(shouldAwaitDetail(loadingHigh)).toBe(false)

    for (const activeQuality of ['locate', 'high', 'legacy'] as const) {
      expect(shouldAwaitDetail({
        status: 'ready', quality: activeQuality, activeQuality, attempt: 1,
      })).toBe(false)
    }
  })

  it('does not wait after a failed first tier or a terminal ISS failure', () => {
    expect(shouldAwaitDetail({ ...base, status: 'failed' })).toBe(false)
    expect(shouldAwaitDetail({ ...base, status: 'unavailable' })).toBe(false)
  })
})

describe('unavailable vs failed terminal states (R4)', () => {
  it('requestISSDetail retries a failed detail but never an unavailable ISS', () => {
    const store = useLoadingStore.getState()
    const attempt = store.beginISSDetailAttempt('high')
    store.failISSDetailAttempt(attempt)
    useLoadingStore.getState().requestISSDetail()
    expect(useLoadingStore.getState().issDetail.status).toBe('loading')

    useLoadingStore.getState().markISSUnavailable()
    expect(useLoadingStore.getState().issDetail.status).toBe('unavailable')
    useLoadingStore.getState().requestISSDetail()
    expect(useLoadingStore.getState().issDetail.status).toBe('unavailable')
  })

  it('markISSUnavailable discards no committed model disclosure and is idempotent', () => {
    const store = useLoadingStore.getState()
    const readyAttempt = store.beginISSDetailAttempt('high')
    store.commitISSDetailReady(readyAttempt)
    useLoadingStore.getState().markISSUnavailable()
    useLoadingStore.getState().markISSUnavailable()
    const detail = useLoadingStore.getState().issDetail
    expect(detail.status).toBe('unavailable')
    expect(detail.activeQuality).toBe('high')
  })

  it('a live attempt continues through an unrelated request (no status clobber)', () => {
    const store = useLoadingStore.getState()
    const attempt = store.beginISSDetailAttempt('high')
    store.setIssDetailPreparing(attempt)
    // A hover/Locate-intent prewarm during an active preparation is a no-op.
    useLoadingStore.getState().requestISSDetail()
    expect(useLoadingStore.getState().issDetail.status).toBe('preparing')
  })
})
