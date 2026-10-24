import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrbitalEntity } from '@/core/entities/OrbitalEntity'
import type { OrbitalState, TLEData } from '@/types/orbital'

const mocks = vi.hoisted(() => ({
  fetchTLE: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheRemove: vi.fn(),
  networkStart: vi.fn(),
  networkStop: vi.fn(),
  networkSuccess: vi.fn(),
  networkFailure: vi.fn(),
  busOn: vi.fn(),
  busEmit: vi.fn(),
  stale: false,
}))

vi.mock('@/core/api/CelesTrakClient', () => ({
  fetchTLEFromCelesTrak: mocks.fetchTLE,
  fetchTLEWithStatus: async (...args: unknown[]) => {
    const tle = await mocks.fetchTLE(...args)
    return tle ? { tle, stale: mocks.stale } : null
  },
}))

vi.mock('@/core/api/TLECache', () => ({
  tleCache: {
    get: mocks.cacheGet,
    set: mocks.cacheSet,
    remove: mocks.cacheRemove,
  },
}))

vi.mock('@/core/telemetry/NetworkMonitor', () => ({
  networkMonitor: {
    isOnline: true,
    start: mocks.networkStart,
    stop: mocks.networkStop,
    recordSuccess: mocks.networkSuccess,
    recordFailure: mocks.networkFailure,
  },
}))

vi.mock('@/core/telemetry/TelemetryEventBus', () => ({
  telemetryBus: {
    on: mocks.busOn,
    emit: mocks.busEmit,
  },
}))

import { TelemetryManager } from '@/core/telemetry/TelemetryManager'
import { networkMonitor } from '@/core/telemetry/NetworkMonitor'
import { buildSimulationTime } from '@/core/clock/SimulationTime'

const currentTLE: TLEData = {
  line1: '1 25544U 98067A   26194.12129675  .00004316  00000+0  86456-4 0  9991',
  line2: '2 25544  51.6304 171.7447 0006685 289.3803  70.6462 15.48996109575778',
  fetchedAt: Date.now(),
  source: 'celestrak',
}

const orbitalState: OrbitalState = {
  entityId: 'iss-test',
  timestamp: Date.now(),
  positionECI: { x: 1, y: 2, z: 3 },
  velocityECI: { x: 4, y: 5, z: 6 },
  latitude: 10,
  longitude: 20,
  altitude: 410,
  speed: 7.6,
  orbitalPeriod: 92,
  inclination: 51.6,
  source: 'live',
  tleAgeHours: 1,
  confidence: 1,
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if (typeof mock === 'function') mock.mockReset()
  }
  mocks.stale = false
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheSet.mockResolvedValue(undefined)
  mocks.cacheRemove.mockResolvedValue(undefined)
  mocks.busOn.mockImplementation(() => vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TelemetryManager lifecycle', () => {
  it('deduplicates starts, ignores a stopped fetch, and restarts cleanly', async () => {
    const fetchResolvers: Array<(tle: TLEData | null) => void> = []
    mocks.fetchTLE.mockImplementation(
      () => new Promise<TLEData | null>((resolve) => fetchResolvers.push(resolve)),
    )

    let installedTLE: TLEData | null = null
    const entity: OrbitalEntity = {
      config: { id: 'iss-test', name: 'ISS test', noradId: 25544, orbitColor: '#fff' },
      loadTLE: vi.fn((tle: TLEData) => {
        installedTLE = tle
        return true
      }),
      clearTLE: vi.fn(() => { installedTLE = null }),
      propagate: vi.fn(() => orbitalState),
      hasTLE: () => installedTLE !== null,
      get currentTLE() { return installedTLE },
    }
    const manager = new TelemetryManager(entity)

    const firstStart = manager.start()
    const duplicateStart = manager.start()
    await vi.waitFor(() => expect(fetchResolvers).toHaveLength(1))

    manager.stop()
    const restarted = manager.start()
    fetchResolvers[0]?.(currentTLE)
    await vi.waitFor(() => expect(fetchResolvers).toHaveLength(2))
    fetchResolvers[1]?.(currentTLE)

    await Promise.all([firstStart, duplicateStart, restarted])

    expect(mocks.networkStart).toHaveBeenCalledTimes(2)
    expect(mocks.busOn).toHaveBeenCalledTimes(2)
    expect(entity.loadTLE).toHaveBeenCalledTimes(1)
    expect(mocks.cacheSet).toHaveBeenCalledTimes(1)
    expect(mocks.networkSuccess).toHaveBeenCalledTimes(1)
    expect(mocks.networkFailure).not.toHaveBeenCalled()
    expect(mocks.busEmit).toHaveBeenCalledWith('TLE_REFRESHED', {
      entityId: 'iss-test',
      tle: currentTLE,
    })

    manager.stop()
    expect(mocks.networkStop).toHaveBeenCalledTimes(2)
  })

  it('does not report success or cache data when entity installation fails', async () => {
    mocks.fetchTLE.mockResolvedValue(currentTLE)

    const entity: OrbitalEntity = {
      config: { id: 'iss-test', name: 'ISS test', noradId: 25544, orbitColor: '#fff' },
      loadTLE: vi.fn(() => false),
      clearTLE: vi.fn(),
      propagate: vi.fn(() => orbitalState),
      hasTLE: () => false,
      get currentTLE() { return null },
    }

    const manager = new TelemetryManager(entity)
    await manager.start()

    expect(mocks.cacheSet).not.toHaveBeenCalled()
    expect(mocks.networkSuccess).not.toHaveBeenCalled()
    expect(mocks.networkFailure).toHaveBeenCalledTimes(1)
    expect(mocks.busEmit).toHaveBeenCalledWith('API_ERROR', expect.objectContaining({
      source: 'celestrak',
    }))

    manager.stop()
  })

  it('never labels fallback data as LIVE even when it is fresh and propagates', async () => {
    const fallback = { ...currentTLE, source: 'fallback' as const }
    mocks.cacheGet.mockResolvedValue(fallback)
    mocks.fetchTLE.mockResolvedValue(null)

    let installedTLE: TLEData | null = null
    const entity: OrbitalEntity = {
      config: { id: 'iss-test', name: 'ISS test', noradId: 25544, orbitColor: '#fff' },
      loadTLE: vi.fn((tle: TLEData) => {
        installedTLE = tle
        return true
      }),
      clearTLE: vi.fn(() => { installedTLE = null }),
      propagate: vi.fn(() => orbitalState),
      hasTLE: () => installedTLE !== null,
      get currentTLE() { return installedTLE },
    }

    const manager = new TelemetryManager(entity)
    await manager.start()

    expect(manager.mode).toBe('HYBRID')
    expect(mocks.busEmit).not.toHaveBeenCalledWith('MODE_CHANGE', 'LIVE')

    manager.stop()
  })

  it('rolls back the previous TLE when the new element set cannot propagate', async () => {
    const fallback = { ...currentTLE, source: 'fallback' as const }
    mocks.fetchTLE.mockResolvedValue(currentTLE)

    let installedTLE: TLEData | null = fallback
    const entity: OrbitalEntity = {
      config: { id: 'iss-test', name: 'ISS test', noradId: 25544, orbitColor: '#fff' },
      loadTLE: vi.fn((tle: TLEData) => {
        installedTLE = tle
        return true
      }),
      clearTLE: vi.fn(() => { installedTLE = null }),
      propagate: vi.fn(() => installedTLE?.source === 'celestrak' ? null : orbitalState),
      hasTLE: () => installedTLE !== null,
      get currentTLE() { return installedTLE },
    }

    const manager = new TelemetryManager(entity)
    await manager.start()

    expect(installedTLE).toEqual(fallback)
    expect(entity.loadTLE).toHaveBeenNthCalledWith(1, currentTLE)
    expect(entity.loadTLE).toHaveBeenNthCalledWith(2, fallback)
    expect(mocks.cacheSet).not.toHaveBeenCalled()
    expect(mocks.networkFailure).toHaveBeenCalledTimes(1)

    manager.stop()
  })

  it('clears a failed first installation when no previous TLE exists', async () => {
    mocks.fetchTLE.mockResolvedValue(currentTLE)

    let installedTLE: TLEData | null = null
    const clearTLE = vi.fn(() => { installedTLE = null })
    const entity: OrbitalEntity = {
      config: { id: 'iss-test', name: 'ISS test', noradId: 25544, orbitColor: '#fff' },
      loadTLE: vi.fn((tle: TLEData) => {
        installedTLE = tle
        return true
      }),
      clearTLE,
      propagate: vi.fn(() => null),
      hasTLE: () => installedTLE !== null,
      get currentTLE() { return installedTLE },
    }

    const manager = new TelemetryManager(entity)
    await manager.start()

    expect(clearTLE).toHaveBeenCalledTimes(1)
    expect(installedTLE).toBeNull()
    expect(mocks.networkSuccess).not.toHaveBeenCalled()

    manager.stop()
  })

  it('eagerly refreshes on reconnect when the session started offline', async () => {
    mocks.fetchTLE.mockResolvedValue(currentTLE)
    // A fresh cached TLE keeps the mode out of RECOVERY, so only the offline
    // flag (not the RECOVERY entry path) can trigger the eager refresh.
    mocks.cacheGet.mockResolvedValue({ ...currentTLE, source: 'fallback' as const })

    let installedTLE: TLEData | null = null
    const entity: OrbitalEntity = {
      config: { id: 'iss-test', name: 'ISS test', noradId: 25544, orbitColor: '#fff' },
      loadTLE: vi.fn((tle: TLEData) => {
        installedTLE = tle
        return true
      }),
      clearTLE: vi.fn(() => { installedTLE = null }),
      propagate: vi.fn(() => orbitalState),
      hasTLE: () => installedTLE !== null,
      get currentTLE() { return installedTLE },
    }

    const monitor = networkMonitor as { isOnline: boolean }
    monitor.isOnline = false
    try {
      const manager = new TelemetryManager(entity)
      await manager.start()
      // Offline start: the bootstrap refresh is skipped without hitting the network.
      expect(mocks.fetchTLE).not.toHaveBeenCalled()

      monitor.isOnline = true
      const handler = mocks.busOn.mock.calls.find(c => c[0] === 'NETWORK_STATUS')?.[1] as () => void
      handler()
      await vi.waitFor(() => expect(mocks.fetchTLE).toHaveBeenCalledTimes(1))

      manager.stop()
    } finally {
      monitor.isOnline = true
    }
  })

  it.each([
    [true, 2],
    [false, 1],
  ])('retry cadence after a successful install (stale=%s) fetches %s time(s) within 6 s', async (stale, expectedFetches) => {
    mocks.stale = stale
    mocks.fetchTLE.mockResolvedValue(currentTLE)

    let installedTLE: TLEData | null = null
    const entity: OrbitalEntity = {
      config: { id: 'iss-test', name: 'ISS test', noradId: 25544, orbitColor: '#fff' },
      loadTLE: vi.fn((tle: TLEData) => {
        installedTLE = tle
        return true
      }),
      clearTLE: vi.fn(() => { installedTLE = null }),
      propagate: vi.fn(() => orbitalState),
      hasTLE: () => installedTLE !== null,
      get currentTLE() { return installedTLE },
    }

    const manager = new TelemetryManager(entity)
    await manager.start()
    // The install itself succeeds either way; only the next-fetch timing differs.
    expect(mocks.busEmit).toHaveBeenCalledWith('TLE_REFRESHED', {
      entityId: 'iss-test',
      tle: currentTLE,
    })
    expect(mocks.fetchTLE).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    vi.advanceTimersByTime(6_000)
    manager.update(buildSimulationTime(Date.now(), 100, 100))
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.fetchTLE).toHaveBeenCalledTimes(expectedFetches)

    manager.stop()
  })

  it('does not replace a network TLE with an older cached one during bootstrap', async () => {
    const cached: TLEData = { ...currentTLE, source: 'fallback' as const }
    let resolveCache: (tle: TLEData) => void = () => undefined
    mocks.cacheGet.mockImplementation(
      () => new Promise<TLEData>((resolve) => { resolveCache = resolve }),
    )
    mocks.fetchTLE.mockResolvedValue(null)

    // The live fetch (started by the runtime's first step) already installed.
    let installedTLE: TLEData | null = currentTLE
    const entity: OrbitalEntity = {
      config: { id: 'iss-test', name: 'ISS test', noradId: 25544, orbitColor: '#fff' },
      loadTLE: vi.fn((tle: TLEData) => {
        installedTLE = tle
        return true
      }),
      clearTLE: vi.fn(() => { installedTLE = null }),
      propagate: vi.fn(() => orbitalState),
      hasTLE: () => installedTLE !== null,
      get currentTLE() { return installedTLE },
    }

    const manager = new TelemetryManager(entity)
    const started = manager.start()
    await vi.waitFor(() => expect(mocks.cacheGet).toHaveBeenCalledTimes(1))
    resolveCache(cached)
    await started

    expect(entity.loadTLE).not.toHaveBeenCalledWith(cached)
    expect(installedTLE).toEqual(currentTLE)
    expect(mocks.cacheRemove).not.toHaveBeenCalled()

    manager.stop()
  })
})
