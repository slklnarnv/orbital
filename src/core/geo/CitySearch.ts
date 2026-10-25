// ─── Observer search (roadmap B.3) ───────────────────────────────────────────
//
// Offline place search for the visible-pass observer: Natural Earth populated
// places (src/data/city-index.json, scripts/build-city-index.mjs) or typed
// coordinates. Everything runs on the device; the observer's location is
// never sent anywhere.

export interface City {
  name: string
  region: string | null
  country: string
  latitudeDeg: number
  longitudeDeg: number
  population: number
}

/** [name, region, country, lat × scale, lon × scale, population] */
export type CityRow = [string, string | null, string, number, number, number]

export interface CityIndexData {
  scale: number
  cities: CityRow[]
}

/**
 * Folds case and diacritics so "sao paulo" finds "São Paulo" and "istanbul"
 * finds "İstanbul". Lowercasing first turns "İ" into "i" + a combining dot,
 * which NFD then strips with the other marks; "ı" and "ß" have no
 * decomposition and are mapped by hand. Punctuation collapses to spaces.
 */
export function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Parses "51.5, -0.12", "51.5 -0.12" or "51.5N 0.12W" (degree signs
 * optional) into a latitude and longitude, or null. A hemisphere letter sets
 * the sign, so it cannot be combined with a minus sign.
 */
export function parseCoordinates(text: string): { latitudeDeg: number; longitudeDeg: number } | null {
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(text)
  if (!match) return null
  const [, latText, latHemi, lonText, lonHemi] = match
  const signed = (value: string, hemisphere: string | undefined, negative: string): number | null => {
    const number = Number(value)
    if (!Number.isFinite(number)) return null
    if (!hemisphere) return number
    if (number < 0) return null
    return hemisphere.toUpperCase() === negative ? -number : number
  }
  const latitudeDeg = signed(latText, latHemi, 'S')
  const longitudeDeg = signed(lonText, lonHemi, 'W')
  if (latitudeDeg === null || longitudeDeg === null) return null
  if (Math.abs(latitudeDeg) > 90 || Math.abs(longitudeDeg) > 180) return null
  return { latitudeDeg, longitudeDeg }
}

interface Entry {
  city: City
  name: string
  words: string[]
  qualifiers: string[]
}

/**
 * City lookup over the bundled index. Ranks an exact name first, then a name
 * prefix, then a word prefix ("york" → "New York"), then a substring; ties
 * keep the index order, which is most populous first. Text after a comma
 * filters by country or region prefix: "london, canada", "paris, tx".
 */
export class CityIndex {
  private readonly entries: Entry[]

  constructor(data: CityIndexData) {
    this.entries = data.cities.map(([name, region, country, lat, lon, population]) => {
      const normalized = normalizeQuery(name)
      return {
        city: { name, region, country, latitudeDeg: lat / data.scale, longitudeDeg: lon / data.scale, population },
        name: normalized,
        words: normalized.split(' '),
        qualifiers: [country, region].filter((value): value is string => value !== null).map(normalizeQuery),
      }
    })
  }

  get size(): number {
    return this.entries.length
  }

  search(query: string, limit = 8): City[] {
    const [namePart, ...rest] = query.split(',')
    const name = normalizeQuery(namePart)
    const qualifier = normalizeQuery(rest.join(' '))
    if (name.length === 0) return []
    const buckets: City[][] = [[], [], [], []]
    for (const entry of this.entries) {
      if (qualifier && !entry.qualifiers.some((value) => value.startsWith(qualifier)
        || value.split(' ').some((word) => word.startsWith(qualifier)))) continue
      let rank = -1
      if (entry.name === name) rank = 0
      else if (entry.name.startsWith(name)) rank = 1
      else if (entry.words.some((word) => word.startsWith(name))) rank = 2
      else if (name.length >= 3 && entry.name.includes(name)) rank = 3
      if (rank >= 0 && buckets[rank].length < limit) buckets[rank].push(entry.city)
    }
    return buckets.flat().slice(0, limit)
  }
}
