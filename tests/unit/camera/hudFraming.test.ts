import { describe, expect, it } from 'vitest'
import {
  easeShift,
  framingShiftPx,
  MAX_SHIFT_FRACTION,
  unobstructedBand,
  type ScreenRect,
} from '@/interaction/camera/hudFraming'

const rect = (left: number, top: number, right: number, bottom: number): ScreenRect => ({ left, top, right, bottom })

describe('unobstructedBand', () => {
  it('is the whole height with no HUD', () => {
    expect(unobstructedBand({ width: 400, height: 800 }, [])).toEqual({ top: 0, bottom: 800 })
  })

  it('ignores corner clusters outside the centred column', () => {
    // 1920 wide: column is 480..1440. Corners at the far edges do not count.
    const band = unobstructedBand({ width: 1920, height: 1080 }, [
      rect(22, 18, 400, 60),
      rect(1500, 18, 1898, 110),
      rect(26, 900, 300, 1030),
    ])
    expect(band).toEqual({ top: 0, bottom: 1080 })
  })

  it('splits boxes by which half their centre is in', () => {
    const band = unobstructedBand({ width: 360, height: 640 }, [
      rect(14, 14, 200, 40), // wordmark, top
      rect(200, 14, 346, 120), // camera + controls, top
      rect(14, 400, 346, 626), // bottom composition
    ])
    expect(band).toEqual({ top: 120, bottom: 400 })
  })

  it('falls back to the whole height when the HUD squeezes the band shut', () => {
    const band = unobstructedBand({ width: 360, height: 640 }, [
      rect(0, 0, 360, 300),
      rect(0, 340, 360, 640),
    ])
    expect(band).toEqual({ top: 0, bottom: 640 })
  })

  it('skips empty rectangles (display: none reports zero size)', () => {
    expect(unobstructedBand({ width: 360, height: 640 }, [rect(0, 500, 0, 500)])).toEqual({ top: 0, bottom: 640 })
  })
})

describe('framingShiftPx', () => {
  it('moves the centre up when the bottom HUD is taller than the top', () => {
    // Band 120..400 → centre 260; canvas centre 320 → shift up 60.
    expect(framingShiftPx({ width: 360, height: 640 }, [
      rect(200, 14, 346, 120),
      rect(14, 400, 346, 626),
    ])).toBe(60)
  })

  it('moves it down when the top HUD dominates', () => {
    expect(framingShiftPx({ width: 400, height: 800 }, [rect(0, 0, 400, 200)])).toBe(-100)
  })

  it('is zero on a wide screen whose clusters stay in the corners', () => {
    expect(framingShiftPx({ width: 1920, height: 1080 }, [rect(22, 18, 400, 60)])).toBe(0)
  })

  it('is clamped to a quarter of the height', () => {
    const shift = framingShiftPx({ width: 400, height: 800 }, [rect(0, 380, 400, 800)], 0.5)
    expect(shift).toBeLessThanOrEqual(800 * MAX_SHIFT_FRACTION)
  })

  it('is zero for a zero-size viewport', () => {
    expect(framingShiftPx({ width: 0, height: 0 }, [rect(0, 0, 10, 10)])).toBe(0)
  })
})

describe('easeShift', () => {
  it('approaches the target and snaps when close', () => {
    let value = 0
    for (let i = 0; i < 120; i++) value = easeShift(value, 80, 1 / 60)
    expect(value).toBe(80)
  })

  it('is frame-rate independent', () => {
    let a = 0
    let b = 0
    for (let i = 0; i < 6; i++) a = easeShift(a, 100, 1 / 60)
    for (let i = 0; i < 3; i++) b = easeShift(b, 100, 1 / 30)
    expect(a).toBeCloseTo(b, 6)
  })

  it('holds still on a zero or invalid delta', () => {
    expect(easeShift(10, 80, 0)).toBe(10)
    expect(easeShift(10, 80, Number.NaN)).toBe(10)
  })
})
