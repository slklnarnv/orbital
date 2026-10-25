import cityIndexUrl from '@/data/city-index.json?url'
import { CityIndex, type CityIndexData } from './CitySearch'

let cityIndexPromise: Promise<CityIndex> | null = null

/**
 * Fetches and decodes the city index once (a same-origin hashed asset, ~150
 * KiB gzip), on the first search rather than at startup. A failed load is
 * retried on the next call.
 */
export function loadCityIndex(): Promise<CityIndex> {
  cityIndexPromise ??= (async () => {
    const response = await fetch(cityIndexUrl, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as CityIndexData
    if (typeof data?.scale !== 'number' || !Array.isArray(data.cities)) throw new Error('Malformed city index')
    return new CityIndex(data)
  })().catch((error: unknown) => {
    cityIndexPromise = null
    throw error
  })
  return cityIndexPromise
}
