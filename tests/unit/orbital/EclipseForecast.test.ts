import { describe, expect, it } from 'vitest'
import {
  forecastShadowTransition,
  ShadowForecaster,
  type GeometryAt,
} from '@/core/orbital/EclipseForecast'
import { EARTH_RADIUS_KM } from '@/utils/constants'

const R = 6771
const PERIOD_MS = 92.68 * 60_000
const OMEGA = (2 * Math.PI) / PERIOD_MS // rad per ms
const RHO_E = Math.asin(EARTH_RADIUS_KM / R)
const ENTRY_MS = (Math.PI - RHO_E) / OMEGA
const EXIT_MS = (Math.PI + RHO_E) / OMEGA
const TOL = 1_500

function circular(sunDir = { x: 1, y: 0, z: 0 }): GeometryAt {
  return (t) => ({
    position: { x: R * Math.cos(OMEGA * t), y: R * Math.sin(OMEGA * t), z: 0 },
    sunDir,
  })
}

describe('forecastShadowTransition', () => {
  it('finds shadow entry from the sunlit side', () => {
    const f = forecastShadowTransition(circular(), 0)
    expect(f?.sunlit).toBe(true)
    expect(f?.transitionMs).not.toBeNull()
    expect(Math.abs((f?.transitionMs ?? 0) - ENTRY_MS)).toBeLessThan(TOL)
  })

  it('finds shadow exit from inside the shadow', () => {
    const f = forecastShadowTransition(circular(), Math.PI / OMEGA)
    expect(f?.sunlit).toBe(false)
    expect(Math.abs((f?.transitionMs ?? 0) - EXIT_MS)).toBeLessThan(TOL)
  })

  it('reports no transition when the orbit plane is perpendicular to the Sun', () => {
    const f = forecastShadowTransition(circular({ x: 0, y: 0, z: 1 }), 0)
    expect(f).toEqual({ sunlit: true, transitionMs: null })
  })

  it('returns null when geometry is unavailable at the start', () => {
    expect(forecastShadowTransition(() => null, 0)).toBeNull()
  })

  it('reports no transition when propagation fails mid-horizon', () => {
    const base = circular()
    const f = forecastShadowTransition((t) => (t > 20_000 ? null : base(t)), 0)
    expect(f).toEqual({ sunlit: true, transitionMs: null })
  })

  it('keeps the transition on the new side of the flip', () => {
    const f = forecastShadowTransition(circular(), 0)
    // Re-forecasting from the reported transition must already see the new state.
    expect(forecastShadowTransition(circular(), f?.transitionMs ?? 0)?.sunlit).toBe(false)
  })
})

describe('ShadowForecaster', () => {
  function counted(): { geometry: GeometryAt; calls: () => number } {
    const base = circular()
    let n = 0
    return {
      geometry: (t) => {
        n++
        return base(t)
      },
      calls: () => n,
    }
  }

  it('does not recompute for a later update with the same key', () => {
    const c = counted()
    const fc = new ShadowForecaster(c.geometry)
    fc.update(0, 'a')
    const after = c.calls()
    fc.update(1_000, 'a')
    expect(c.calls()).toBe(after)
  })

  it('recomputes when the key changes', () => {
    const c = counted()
    const fc = new ShadowForecaster(c.geometry)
    fc.update(0, 'a')
    const after = c.calls()
    fc.update(1_000, 'b')
    expect(c.calls()).toBeGreaterThan(after)
  })

  it('recomputes when simulation time moves backwards', () => {
    const c = counted()
    const fc = new ShadowForecaster(c.geometry)
    fc.update(5_000, 'a')
    const after = c.calls()
    fc.update(1_000, 'a')
    expect(c.calls()).toBeGreaterThan(after)
  })

  it('recomputes once the cached transition is reached', () => {
    const c = counted()
    const fc = new ShadowForecaster(c.geometry)
    const first = fc.update(0, 'a')
    const after = c.calls()
    fc.update((first?.transitionMs ?? 0) - 1, 'a')
    expect(c.calls()).toBe(after)
    const next = fc.update((first?.transitionMs ?? 0) + 1, 'a')
    expect(c.calls()).toBeGreaterThan(after)
    expect(next?.sunlit).toBe(false)
  })

  it('recomputes after half the horizon with no transition', () => {
    const base = circular({ x: 0, y: 0, z: 1 })
    let n = 0
    const fc = new ShadowForecaster((t) => {
      n++
      return base(t)
    })
    fc.update(0, 'a')
    const after = n
    fc.update(60_000, 'a')
    expect(n).toBe(after)
    fc.update(93 * 60_000 + 1, 'a')
    expect(n).toBeGreaterThan(after)
  })
})
