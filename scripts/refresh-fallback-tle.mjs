import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Refreshes src/data/fallback-tle.json from CelesTrak (wheretheiss.at as a
// mirror). Run before each release: the packaged TLE seeds propagation on a
// cold, offline start, and past ~7 days from its epoch it pins the app in
// RECOVERY. Validation mirrors api/tle.ts: line shape, checksums, catalog.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'src/data/fallback-tle.json')
const ISS_NORAD_ID = 25544
const SOURCES = [
  `https://celestrak.org/NORAD/elements/gp.php?CATNR=${ISS_NORAD_ID}&FORMAT=TLE`,
  `https://api.wheretheiss.at/v1/satellites/${ISS_NORAD_ID}/tles?format=text`,
]

export function hasValidChecksum(line) {
  let checksum = 0
  for (const char of line.slice(0, 68)) {
    if (char >= '0' && char <= '9') checksum += Number(char)
    else if (char === '-') checksum += 1
  }
  return checksum % 10 === Number(line[68])
}

/** TLE epoch (line 1 cols 19-32, YYDDD.DDDDDDDD) → Date, or null. */
export function tleEpoch(line1) {
  const field = line1.slice(18, 32)
  if (!/^\d{5}\.\d{8}$/.test(field)) return null
  const shortYear = Number(field.slice(0, 2))
  const day = Number(field.slice(2))
  const year = shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear
  return new Date(Date.UTC(year, 0, 1) + (day - 1) * 86_400_000)
}

export function parseTLE(raw) {
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)
  const line1 = lines.find(line => line.startsWith('1 '))
  const line2 = lines.find(line => line.startsWith('2 '))
  if (!line1 || !line2 || line1.length !== 69 || line2.length !== 69) return null
  if (!hasValidChecksum(line1) || !hasValidChecksum(line2)) return null
  if (Number(line1.slice(2, 7)) !== ISS_NORAD_ID || Number(line2.slice(2, 7)) !== ISS_NORAD_ID) return null
  const epoch = tleEpoch(line1)
  return epoch ? { line1, line2, epoch } : null
}

async function main() {
  const previous = JSON.parse(await readFile(target, 'utf8'))
  for (const url of SOURCES) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const tle = parseTLE(await response.text())
      if (!tle) throw new Error('invalid TLE')
      const next = {
        _comment: previous._comment,
        line1: tle.line1,
        line2: tle.line2,
        epoch: tle.epoch.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        source: 'fallback',
      }
      await writeFile(target, `${JSON.stringify(next, null, 2)}\n`)
      console.log(`Fallback TLE refreshed from ${new URL(url).host}: epoch ${next.epoch}`)
      return
    } catch (error) {
      console.warn(`- ${new URL(url).host}: ${error instanceof Error ? error.message : error}`)
    }
  }
  console.error('All TLE sources failed; fallback-tle.json left unchanged.')
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
