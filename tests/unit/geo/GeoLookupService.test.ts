import { describe, expect, it } from 'vitest'
import {
  cellKeyFor,
  describeWeatherCode,
  formatLocalClock,
  placeFromBigDataCloud,
  weatherFromOpenMeteo,
} from '@/core/geo/GeoLookupService'

describe('cellKeyFor', () => {
  it('snaps a position onto its 2-degree ground cell', () => {
    expect(cellKeyFor(51.64, 170.71)).toBe('52,170')
  })

  it('handles the southern and western hemispheres', () => {
    expect(cellKeyFor(-33.87, -58.04)).toBe('-34,-58')
  })

  it('wraps longitude snapping without exceeding ±180', () => {
    // 179.9 rounds to the 180 cell — rendering only; cache key is stable either way
    const key = cellKeyFor(10.0, 179.9)
    expect(key).toBe('10,180')
  })
})

describe('placeFromBigDataCloud', () => {
  it('resolves the marine region from locality over open water', () => {
    const place = placeFromBigDataCloud({
      continent: '',
      countryName: '',
      locality: 'Pacific Ocean',
    })
    expect(place).toEqual({ placeName: 'Pacific Ocean', continent: null })
  })

  it('names the country and continent over land', () => {
    const place = placeFromBigDataCloud({
      continent: 'Asia',
      countryName: 'Japan',
      locality: 'Shibuya',
    })
    expect(place).toEqual({ placeName: 'Japan', continent: 'Asia' })
  })

  it('prefers the country over the finer locality', () => {
    const place = placeFromBigDataCloud({
      continent: 'Europe',
      countryName: 'United Kingdom',
      locality: 'England',
    })
    expect(place).toEqual({ placeName: 'United Kingdom', continent: 'Europe' })
  })

  it('returns null for empty or malformed payloads', () => {
    expect(placeFromBigDataCloud({ countryName: '', locality: '' })).toBeNull()
    expect(placeFromBigDataCloud({ error: true })).toBeNull()
    expect(placeFromBigDataCloud(null)).toBeNull()
  })
})

describe('weatherFromOpenMeteo', () => {
  it('extracts weather and timezone facts', () => {
    const wx = weatherFromOpenMeteo({
      timezone: 'Asia/Tokyo',
      timezone_abbreviation: 'JST',
      utc_offset_seconds: 32400,
      current: { temperature_2m: 21.4, weather_code: 2 },
    })
    expect(wx).toEqual({
      timezone: 'Asia/Tokyo',
      tzAbbreviation: 'JST',
      utcOffsetSeconds: 32400,
      temperatureC: 21.4,
      weatherCode: 2,
    })
  })

  it('returns null when the current block is missing or non-numeric', () => {
    expect(weatherFromOpenMeteo({ error: true })).toBeNull()
    expect(weatherFromOpenMeteo({ current: { temperature_2m: '21' } })).toBeNull()
    expect(weatherFromOpenMeteo(null)).toBeNull()
  })
})

describe('describeWeatherCode', () => {
  it('maps WMO codes to HUD vocabulary', () => {
    expect(describeWeatherCode(0)).toBe('Clear')
    expect(describeWeatherCode(61)).toBe('Rain')
    expect(describeWeatherCode(95)).toBe('Thunderstorm')
  })

  it('degrades unknown codes to an em dash', () => {
    expect(describeWeatherCode(142)).toBe('—')
  })
})

describe('formatLocalClock', () => {
  it('shifts the UTC clock by the ground-point offset', () => {
    const epochMs = Date.UTC(2026, 8, 2, 14, 32, 0)
    expect(formatLocalClock(epochMs, 0)).toBe('14:32')
    expect(formatLocalClock(epochMs, 9 * 3600)).toBe('23:32')
  })

  it('rolls across the date boundary without leaking it into the time', () => {
    const epochMs = Date.UTC(2026, 8, 2, 23, 59, 0)
    expect(formatLocalClock(epochMs, 3600)).toBe('00:59')
  })
})
