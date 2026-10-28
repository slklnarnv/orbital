// ─── moduleExplorerControl.test.ts — Modules is never a dead end ────────────
//
// The Modules control used to appear only while the station was tracked, at
// mid-left, where few found it. It now lives in the top-right tool row and
// works from anywhere: away from the station it locates, and the explorer
// opens when the camera arrives — unless the request has gone stale.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCameraStore } from '@/stores/cameraStore'
import { PENDING_OPEN_MS, useExplorerStore } from '@/stores/explorerStore'
import { toggleModuleExplorer } from '@/ui/clusters/moduleExplorerControl'

const explorer = useExplorerStore.getState

describe('toggleModuleExplorer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 28, 12))
    explorer().setOpen(false)
    explorer().setAvailability('hidden')
    useExplorerStore.setState({ pendingOpenAt: null })
    useCameraStore.setState({ isTransitioning: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('toggles the explorer while the station is tracked', () => {
    explorer().setAvailability('available')
    toggleModuleExplorer()
    expect(explorer().open).toBe(true)
    toggleModuleExplorer()
    expect(explorer().open).toBe(false)
  })

  it('locates from afar and opens on arrival', () => {
    toggleModuleExplorer()
    expect(useCameraStore.getState().isTransitioning).toBe(true)
    expect(explorer().open).toBe(false)
    vi.advanceTimersByTime(4_000)
    explorer().setAvailability('available')
    expect(explorer()).toMatchObject({ open: true, pendingOpenAt: null })
  })

  it('opens on arrival on a model without the explorer, to say so', () => {
    toggleModuleExplorer()
    explorer().setAvailability('unavailable')
    expect(explorer().open).toBe(true)
  })

  it('drops a stale request instead of opening much later', () => {
    toggleModuleExplorer()
    vi.advanceTimersByTime(PENDING_OPEN_MS + 1)
    explorer().setAvailability('available')
    expect(explorer().open).toBe(false)
  })

  it('a later Locate after closing does not reopen it', () => {
    toggleModuleExplorer()
    explorer().setAvailability('available')
    explorer().setOpen(false)
    explorer().setAvailability('hidden')
    explorer().setAvailability('available')
    expect(explorer().open).toBe(false)
  })
})
