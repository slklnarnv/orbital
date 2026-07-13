import { beforeEach, describe, expect, it, vi } from 'vitest'
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
}))

vi.mock('@/core/api/CelesTrakClient', () => ({
  fetchTLEFromCelesTrak: mocks.fetchTLE,
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
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheSet.mockResolvedValue(undefined)
  mocks.cacheRemove.mockResolvedValue(undefined)
  mocks.busOn.mockImplementation(() => vi.fn())
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
})
