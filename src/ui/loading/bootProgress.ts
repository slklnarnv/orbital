/**
 * Staged boot progress for the loading screen (plan 017 I2).
 *
 * The honest unit is the file: three's LoadingManager reports when each URL
 * starts and ends, not bytes (image loads expose no byte progress). Each URL
 * is sorted into the stage the user cares about, and a stage reads "2 of 5 files"
 * until every file it has seen has ended. Totals can grow while a stage loads
 * (the Draco decoder is requested only once the station GLB arrives), so the
 * label never claims more than what is known.
 *
 * Pure: no three, no React, so it stays unit-testable in node.
 */

export type AssetStage = 'earth' | 'station' | 'other'

/**
 * `/textures/` holds the Earth maps and the star map (the sky is part of the
 * Earth stage). The station is the GLB plus its decoders; GLTFLoader also
 * routes embedded textures through the manager as `blob:` URLs, and nothing
 * else in the app creates blob URLs at boot.
 */
export function stageForUrl(url: string): AssetStage {
  if (url.startsWith('blob:') || url.startsWith('data:')) return 'station'
  // Drop any scheme and host, so relative and absolute URLs read the same path.
  const pathname = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
  if (pathname.startsWith('/textures/')) return 'earth'
  if (pathname.startsWith('/models/') || pathname.startsWith('/draco/') || pathname.startsWith('/basis/')) {
    return 'station'
  }
  return 'other'
}

export interface StageTally {
  /** Distinct URLs seen. */
  total: number
  /** URLs whose every start has ended. */
  ended: number
  /** URLs that reported an error (they also end). */
  failed: number
}

export type AssetSnapshot = Record<AssetStage, StageTally>

const EMPTY_TALLY: StageTally = { total: 0, ended: 0, failed: 0 }

export const EMPTY_ASSET_SNAPSHOT: AssetSnapshot = {
  earth: EMPTY_TALLY,
  station: EMPTY_TALLY,
  other: EMPTY_TALLY,
}

/**
 * Per-URL bookkeeping. A URL can start more than once before it ends
 * (FileLoader and GLTFLoader both report the GLB), so starts are counted and
 * the URL is done when the count returns to zero.
 */
export class AssetLoadTally {
  private readonly pending = new Map<string, number>()
  private readonly failed = new Set<string>()

  itemStart(url: string): void {
    this.pending.set(url, (this.pending.get(url) ?? 0) + 1)
  }

  itemEnd(url: string): void {
    const count = this.pending.get(url)
    if (count === undefined) return
    this.pending.set(url, Math.max(0, count - 1))
  }

  itemError(url: string): void {
    this.failed.add(url)
  }

  snapshot(): AssetSnapshot {
    const tallies: Record<AssetStage, StageTally> = {
      earth: { ...EMPTY_TALLY },
      station: { ...EMPTY_TALLY },
      other: { ...EMPTY_TALLY },
    }
    for (const [url, count] of this.pending) {
      const tally = tallies[stageForUrl(url)]
      tally.total += 1
      if (count === 0) tally.ended += 1
      if (this.failed.has(url)) tally.failed += 1
    }
    return tallies
  }
}

/** "Waiting" before the first file, "2 of 5 files" while loading, "Ready" when done. */
export function stageLabel(tally: StageTally): string {
  if (tally.total === 0) return 'Waiting'
  if (tally.ended < tally.total) return `${tally.ended} of ${tally.total} ${tally.total === 1 ? 'file' : 'files'}`
  if (tally.failed > 0) return tally.failed === 1 ? '1 file failed' : `${tally.failed} files failed`
  return 'Ready'
}

/**
 * The gate: both visible stages have started and every known file has ended.
 * Requiring both stages keeps the screen up during the gap before the first
 * request, when an empty tally would otherwise read as "done".
 */
export function assetsSettled(snapshot: AssetSnapshot): boolean {
  if (snapshot.earth.total === 0 || snapshot.station.total === 0) return false
  return (Object.keys(snapshot) as AssetStage[]).every((stage) => {
    const tally = snapshot[stage]
    return tally.ended === tally.total
  })
}

/** Ended files over known files, 0..1 (0 before anything is known). */
export function assetFraction(snapshot: AssetSnapshot): number {
  let total = 0
  let ended = 0
  for (const stage of Object.keys(snapshot) as AssetStage[]) {
    total += snapshot[stage].total
    ended += snapshot[stage].ended
  }
  return total === 0 ? 0 : ended / total
}
