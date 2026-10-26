// ─── bootProgress.test.ts — staged loading-screen progress (plan 017 I2) ─────

import { describe, expect, it } from 'vitest'

import {
  AssetLoadTally,
  EMPTY_ASSET_SNAPSHOT,
  assetFraction,
  assetsSettled,
  stageForUrl,
  stageLabel,
} from '@/ui/loading/bootProgress'

const DAY = '/textures/earth-day-4k.webp?v=abc'
const NIGHT = '/textures/earth-night-4k.webp?v=abc'
const MODEL = '/models/International%20Space%20Station%20(ISS)%20(A).glb?v=abc'
const DRACO = '/draco/draco_decoder.wasm'

describe('stageForUrl', () => {
  it('sorts runtime asset URLs into the stage the user sees', () => {
    expect(stageForUrl(DAY)).toBe('earth')
    expect(stageForUrl('https://orbitaliss.vercel.app/textures/starmap-4k.webp')).toBe('earth')
    expect(stageForUrl(MODEL)).toBe('station')
    expect(stageForUrl(DRACO)).toBe('station')
    expect(stageForUrl('/basis/basis_transcoder.wasm')).toBe('station')
    // GLTFLoader routes embedded textures through the manager as blob URLs.
    expect(stageForUrl('blob:http://localhost:5173/1f0c')).toBe('station')
    expect(stageForUrl('/api/tle')).toBe('other')
  })
})

describe('AssetLoadTally', () => {
  it('counts distinct URLs and ends a URL only when every start has ended', () => {
    const tally = new AssetLoadTally()
    // FileLoader and GLTFLoader both report the GLB.
    tally.itemStart(MODEL)
    tally.itemStart(MODEL)
    tally.itemEnd(MODEL)
    expect(tally.snapshot().station).toEqual({ total: 1, ended: 0, failed: 0 })
    tally.itemEnd(MODEL)
    expect(tally.snapshot().station).toEqual({ total: 1, ended: 1, failed: 0 })
  })

  it('lets totals grow when a stage requests more files', () => {
    const tally = new AssetLoadTally()
    tally.itemStart(MODEL)
    tally.itemStart(DRACO)
    tally.itemEnd(DRACO)
    expect(stageLabel(tally.snapshot().station)).toBe('1 of 2 files')
    tally.itemEnd(MODEL)
    expect(stageLabel(tally.snapshot().station)).toBe('Ready')
  })

  it('reports failures once the failed file has ended', () => {
    const tally = new AssetLoadTally()
    tally.itemStart(DAY)
    tally.itemError(DAY)
    tally.itemEnd(DAY)
    expect(stageLabel(tally.snapshot().earth)).toBe('1 file failed')
  })

  it('ignores an end without a start', () => {
    const tally = new AssetLoadTally()
    tally.itemEnd(DAY)
    expect(tally.snapshot()).toEqual(EMPTY_ASSET_SNAPSHOT)
  })
})

describe('the gate', () => {
  it('stays up until both stages have started and every file has ended', () => {
    const tally = new AssetLoadTally()
    expect(assetsSettled(tally.snapshot())).toBe(false)

    tally.itemStart(DAY)
    tally.itemEnd(DAY)
    // Earth done, station not requested yet: an empty stage is not "done".
    expect(assetsSettled(tally.snapshot())).toBe(false)

    tally.itemStart(NIGHT)
    tally.itemStart(MODEL)
    tally.itemStart('/api/other-thing')
    tally.itemEnd(NIGHT)
    tally.itemEnd(MODEL)
    // An unclassified file still in flight holds the gate.
    expect(assetsSettled(tally.snapshot())).toBe(false)
    expect(assetFraction(tally.snapshot())).toBe(0.75)

    tally.itemEnd('/api/other-thing')
    expect(assetsSettled(tally.snapshot())).toBe(true)
    expect(assetFraction(tally.snapshot())).toBe(1)
  })

  it('reads empty as zero progress and Waiting', () => {
    expect(assetFraction(EMPTY_ASSET_SNAPSHOT)).toBe(0)
    expect(stageLabel(EMPTY_ASSET_SNAPSHOT.earth)).toBe('Waiting')
  })
})

describe('stageLabel', () => {
  it('uses the singular for one file', () => {
    expect(stageLabel({ total: 1, ended: 0, failed: 0 })).toBe('0 of 1 file')
  })
})
