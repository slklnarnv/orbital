import { describe, expect, it } from 'vitest'
import { applyEarthDetailOverride, decideEarthDetail, type EarthDetailCapabilities } from '@/rendering/earth/earthDetail'

const desktop: EarthDetailCapabilities = {
  maxTextureSize: 16384,
  finePointer: true,
  saveData: false,
  compressedFormat: true,
}

describe('8K Earth capability gate (plan 017 V2)', () => {
  it('streams on a capable desktop', () => {
    expect(decideEarthDetail(desktop)).toEqual({ stream: true })
    expect(decideEarthDetail({ ...desktop, maxTextureSize: 8192 })).toEqual({ stream: true })
  })

  it('keeps 4K where 8K cannot be held or is not wanted', () => {
    expect(decideEarthDetail({ ...desktop, maxTextureSize: 4096 })).toEqual({ stream: false, reason: 'max-texture-size' })
    expect(decideEarthDetail({ ...desktop, finePointer: false })).toEqual({ stream: false, reason: 'coarse-pointer' })
    expect(decideEarthDetail({ ...desktop, saveData: true })).toEqual({ stream: false, reason: 'save-data' })
    // Without a GPU format Basis falls back to RGBA32: 171 MiB per map.
    expect(decideEarthDetail({ ...desktop, compressedFormat: false })).toEqual({ stream: false, reason: 'no-compressed-format' })
  })

  it('honours the dev/bench override only for its two values', () => {
    const phone = decideEarthDetail({ ...desktop, finePointer: false })
    expect(applyEarthDetailOverride(phone, 'on')).toEqual({ stream: true })
    expect(applyEarthDetailOverride({ stream: true }, 'off')).toEqual({ stream: false, reason: 'disabled' })
    expect(applyEarthDetailOverride(phone, undefined)).toBe(phone)
    expect(applyEarthDetailOverride(phone, 'yes')).toBe(phone)
  })
})
