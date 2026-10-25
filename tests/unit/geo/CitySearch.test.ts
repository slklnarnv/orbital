// ─── CitySearch.test.ts — offline observer search (roadmap B.3) ─────────────

import { describe, expect, it } from 'vitest'

import { CityIndex, normalizeQuery, parseCoordinates, type CityIndexData } from '@/core/geo/CitySearch'
import cityIndex from '@/data/city-index.json'

describe('normalizeQuery', () => {
  it('folds case, diacritics and the letters NFD cannot decompose', () => {
    expect(normalizeQuery('São Paulo')).toBe('sao paulo')
    expect(normalizeQuery('ZÜRICH')).toBe('zurich')
    expect(normalizeQuery('İstanbul')).toBe('istanbul')
    expect(normalizeQuery('Diyarbakır')).toBe('diyarbakir')
    expect(normalizeQuery('Straße')).toBe('strasse')
    expect(normalizeQuery("  Port-de-Paix, Haïti ")).toBe('port de paix haiti')
  })
})

describe('parseCoordinates', () => {
  it('reads signed decimals and hemisphere letters', () => {
    expect(parseCoordinates('51.5, -0.12')).toEqual({ latitudeDeg: 51.5, longitudeDeg: -0.12 })
    expect(parseCoordinates('51.5 -0.12')).toEqual({ latitudeDeg: 51.5, longitudeDeg: -0.12 })
    expect(parseCoordinates('33.87S 151.21E')).toEqual({ latitudeDeg: -33.87, longitudeDeg: 151.21 })
    expect(parseCoordinates('40.71° N, 74.01° W')).toEqual({ latitudeDeg: 40.71, longitudeDeg: -74.01 })
  })

  it('rejects out-of-range and ambiguous input', () => {
    expect(parseCoordinates('91, 0')).toBeNull()
    expect(parseCoordinates('0, 181')).toBeNull()
    expect(parseCoordinates('-33 S, 151 E')).toBeNull()
    expect(parseCoordinates('London')).toBeNull()
    expect(parseCoordinates('51.5')).toBeNull()
  })
})

const fixture: CityIndexData = {
  scale: 100,
  cities: [
    ['London', 'Westminster', 'United Kingdom', 5150, -12, 8_567_000],
    ['New York', null, 'United States of America', 4075, -7398, 19_040_000],
    ['London', 'Ontario', 'Canada', 4298, -8125, 346_765],
    ['Londonderry', null, 'United Kingdom', 5500, -733, 83_652],
    ['York', null, 'United Kingdom', 5396, -108, 153_717],
  ],
}

describe('CityIndex', () => {
  const index = new CityIndex(fixture)

  it('ranks exact, then prefix, then word prefix, keeping population order', () => {
    expect(index.search('london').map((c) => `${c.name}, ${c.country}`)).toEqual([
      'London, United Kingdom',
      'London, Canada',
      'Londonderry, United Kingdom',
    ])
    expect(index.search('york').map((c) => c.name)).toEqual(['York', 'New York'])
  })

  it('filters by country or region after a comma', () => {
    expect(index.search('london, canada').map((c) => c.country)).toEqual(['Canada'])
    expect(index.search('london, ont').map((c) => c.region)).toEqual(['Ontario'])
    expect(index.search('london, kingdom').map((c) => c.name)).toEqual(['London', 'Londonderry'])
  })

  it('decodes coordinates from the index scale', () => {
    const [first] = index.search('new york')
    expect(first.latitudeDeg).toBeCloseTo(40.75, 6)
    expect(first.longitudeDeg).toBeCloseTo(-73.98, 6)
  })

  it('finds accented names in the shipped index', () => {
    const real = new CityIndex(cityIndex as unknown as CityIndexData)
    expect(real.size).toBeGreaterThan(7000)
    expect(real.search('sao paulo')[0].name).toBe('São Paulo')
    expect(real.search('zurich')[0].name).toBe('Zürich')
    expect(real.search('london')[0].country).toBe('United Kingdom')
    expect(real.search('')).toEqual([])
  })
})
