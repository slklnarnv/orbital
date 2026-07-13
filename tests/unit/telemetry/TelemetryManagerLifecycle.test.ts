import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrbitalEntity } from '@/core/entities/OrbitalEntity'
import type { TLEData } from '@/types/orbital'

const mocks = vi.hoisted(() => ({
  fetchTLE: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  networkStart: vi.fn(),
  networkStop: vi.fn(),
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
  },
}))

vi.mock('@/core/telemetry/NetworkMonitor', () => ({
  networkMonitor: {
    isOnline: true,
    start: mocks.networkStart,
    stop: mocks.networkStop,
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
  line1: '1 25544U 98067A   26194.50000000  .00000000  00000-0  00000-0 0  9999',
  line2: '2 25544  51.6400 100.0000 0005000 100.0000 200.0000 15.50000000123456',
  fetchedAt: Date.now(),
  source: 'celestrak',
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheSet.mockResolvedValue(undefined)
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
      propagate: vi.fn(() => null),
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
    expect(mocks.busEmit).toHaveBeenCalledWith('TLE_REFRESHED', {
      entityId: 'iss-test',
      tle: currentTLE,
    })

    manager.stop()
    expect(mocks.networkStop).toHaveBeenCalledTimes(2)
  })
})
