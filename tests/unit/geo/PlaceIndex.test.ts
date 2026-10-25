// ─── PlaceIndex.test.ts — the offline "Passing over" lookup ──────────────────
//
// Known answers against the shipped Natural Earth index, plus the coverage
// guarantee the HUD relies on: every point the ISS can pass over names a
// country or a water body.

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlaceIndex, type PlaceIndexData } from '@/core/geo/PlaceIndex'
import { encodeRing, tidyWaterName } from '../../../scripts/build-place-index.mjs'

const INDEX_FILE = path.resolve(__dirname, '../../../src/data/place-index.json')
const data = JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as PlaceIndexData
const index = new PlaceIndex(data)

/** ISS orbital inclination, so the highest latitude its ground track reaches. */
const ISS_MAX_LATITUDE = 51.64

describe('PlaceIndex known answers', () => {
  it('names the country and continent over land', () => {
    expect(index.lookup(35.68, 139.77)).toEqual({ placeName: 'Japan', continent: 'Asia' })
    expect(index.lookup(-31.4, -64.2)).toEqual({ placeName: 'Argentina', continent: 'South America' })
    expect(index.lookup(39.0, -100.0)).toEqual({ placeName: 'United States of America', continent: 'North America' })
    expect(index.lookup(-25.0, 134.0)).toEqual({ placeName: 'Australia', continent: 'Oceania' })
  })

  it('names the ocean over open water, with no continent', () => {
    expect(index.lookup(30, -150)).toEqual({ placeName: 'North Pacific Ocean', continent: null })
    expect(index.lookup(-30, -15)).toEqual({ placeName: 'South Atlantic Ocean', continent: null })
  })

  it('prefers the most specific water body', () => {
    expect(index.lookup(15, -75)?.placeName).toBe('Caribbean Sea')
    expect(index.lookup(38.5, 18.5)?.placeName).toBe('Ionian Sea')      // inside the Mediterranean
    expect(index.lookup(-16, 146.5)?.placeName).toBe('Great Barrier Reef') // inside the Coral Sea
  })

  it('splits Russia at the Urals', () => {
    expect(index.lookup(55.75, 37.6)).toEqual({ placeName: 'Russia', continent: 'Europe' })
    expect(index.lookup(51.0, 85.0)).toEqual({ placeName: 'Russia', continent: 'Asia' })
    expect(index.lookup(66.0, -172.0)).toEqual({ placeName: 'Russia', continent: 'Asia' })
  })

  it('snaps coastal gaps in the marine polygons to the nearest water body', () => {
    // Bass Strait has no Natural Earth marine polygon.
    const place = index.lookup(-39.5, 146.0)
    expect(place?.continent).toBeNull()
    expect(place?.placeName).toMatch(/Sea|Ocean|Bight/)
  })

  it('answers with the country inside its lakes and rivers and on border slivers', () => {
    expect(index.lookup(46.36, -72.5)?.placeName).toBe('Canada')   // St. Lawrence, cut out of Canada
    expect(index.lookup(27.86, 92.5)?.continent).toBe('Asia')      // India/Bhutan/China border sliver
  })

  it('wraps longitude and rejects non-finite input', () => {
    expect(index.lookup(35.68, 139.77 + 360)?.placeName).toBe('Japan')
    expect(index.lookup(35.68, 139.77 - 720)?.placeName).toBe('Japan')
    expect(index.lookup(Number.NaN, 0)).toBeNull()
  })
})

describe('PlaceIndex coverage', () => {
  it('names every point of the ISS latitude band', () => {
    const unnamed: string[] = []
    for (let lat = -ISS_MAX_LATITUDE; lat <= ISS_MAX_LATITUDE; lat += 0.5) {
      for (let lon = -180; lon < 180; lon += 0.5) {
        if (index.lookup(lat, lon) === null) unnamed.push(`${lat},${lon}`)
      }
    }
    expect(unnamed).toEqual([])
  })

  it('stores no all-caps names (HUD text is sentence or title case)', () => {
    for (const place of data.places) expect(place.name).not.toMatch(/^[^a-z]+$/)
  })

  it('stays small enough to lazy-load (≤ 600 KiB raw)', () => {
    expect(statSync(INDEX_FILE).size).toBeLessThanOrEqual(600 * 1024)
  })
})

describe('build-place-index encoding', () => {
  it('delta-encodes a closed ring at 0.01° without its closing point', () => {
    expect(encodeRing([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])).toEqual([0, 0, 100, 0, 0, 100, -100, 0])
  })

  it('drops rings that collapse below a triangle', () => {
    expect(encodeRing([[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]])).toBeNull()
  })

  it('title-cases all-caps water names only', () => {
    expect(tidyWaterName('SOUTHERN OCEAN')).toBe('Southern Ocean')
    expect(tidyWaterName('Bahía de Campeche')).toBe('Bahía de Campeche')
  })
})
