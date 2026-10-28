// ─── skyBuild.test.ts — the star catalogue build and the shipped file ────────

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bvToRgb, packStars, parseBscLine } from '../../../scripts/build-sky.mjs'
import { parseStarCatalog } from '@/rendering/scene/starCatalog'

/** A Node Buffer's bytes as a standalone ArrayBuffer. */
const toArrayBuffer = (b: Buffer): ArrayBuffer => new Uint8Array(b).buffer

// Two records of the Yale BSC5 (CDS V/50 catalog), verbatim through column 114.
const SIRIUS = '2491  9Alp CMaBD-16 1591  48915151881 257I   5423           064044.6-163444064508.9-164258227.22-08.88-1.46   0.00 -0.05'
const POLARIS = ' 424  1Alp UMiBD+88    8   8890   308 907    1477  Alp UMi  012233.7+884626023148.7+891551123.28 26.46 2.02  +0.60 +0.38'

type Star = { hr: number; raDeg: number; decDeg: number; vmag: number; bv: number | null }

describe('parseBscLine', () => {
  it('reads J2000 position, V and B−V from the fixed columns', () => {
    const s = parseBscLine(SIRIUS) as Star
    expect(s.hr).toBe(2491)
    expect(s.raDeg).toBeCloseTo((6 + 45 / 60 + 8.9 / 3600) * 15, 6)
    expect(s.decDeg).toBeCloseTo(-(16 + 42 / 60 + 58 / 3600), 6)
    expect(s.vmag).toBe(-1.46)
    expect(s.bv).toBe(0)
    const p = parseBscLine(POLARIS) as Star
    expect(p.decDeg).toBeCloseTo(89 + 15 / 60 + 51 / 3600, 6)
    expect(p.vmag).toBe(2.02)
  })

  it('skips the entries kept only for numbering', () => {
    expect(parseBscLine('  92          BD+75   12   2283                        I          ')).toBeNull()
  })
})

describe('bvToRgb', () => {
  it('tints hot stars blue and cool stars orange, gently', () => {
    const [br, , bb] = bvToRgb(-0.2) as number[]
    const [rr, , rb] = bvToRgb(1.6) as number[]
    expect(bb).toBeGreaterThan(br)
    expect(rr).toBeGreaterThan(rb)
    // Pale tints: no channel falls below 40% of white.
    for (const c of [...bvToRgb(-0.4), ...bvToRgb(2.0)] as number[]) expect(c).toBeGreaterThan(100)
    expect(bvToRgb(null)).toEqual([255, 255, 255])
  })
})

describe('stars.bin', () => {
  it('round-trips through packStars and parseStarCatalog', () => {
    const stars = [parseBscLine(SIRIUS), parseBscLine(POLARIS)]
    const packed: Buffer = packStars(stars)
    const catalog = parseStarCatalog(toArrayBuffer(packed))
    expect(catalog.count).toBe(2)
    expect(catalog.magnitudes[0]).toBeCloseTo(-1.46, 3)
    expect(catalog.magnitudes[1]).toBeCloseTo(2.02, 3)
  })

  it('ships the whole catalogue with Sirius where it belongs', () => {
    const bytes = readFileSync(new URL('../../../public/textures/stars.bin', import.meta.url))
    const catalog = parseStarCatalog(toArrayBuffer(bytes))
    expect(catalog.count).toBe(9096)
    let brightest = 0
    for (let i = 1; i < catalog.count; i++) if (catalog.magnitudes[i] < catalog.magnitudes[brightest]) brightest = i
    expect(catalog.magnitudes[brightest]).toBeCloseTo(-1.46, 3)
    const [x, y, z] = [0, 1, 2].map((k) => catalog.directions[brightest * 3 + k] / 32767)
    const ra = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
    const dec = (Math.asin(z) * 180) / Math.PI
    expect(ra).toBeCloseTo((6 + 45 / 60 + 8.9 / 3600) * 15, 1)
    expect(dec).toBeCloseTo(-(16 + 42 / 60 + 58 / 3600), 1)
  })
})
