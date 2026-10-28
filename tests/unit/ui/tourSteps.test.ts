// ─── tourSteps.test.ts — the guided tour's placement and first-visit flag ───

import { describe, expect, it } from 'vitest'

import {
  CARD_GAP,
  TOUR_SEEN_KEY,
  TOUR_STEPS,
  markTourSeen,
  placeCard,
  readTourSeen,
  spotlightBox,
} from '@/ui/tour/tourSteps'

const viewport = { width: 1366, height: 768 }
const card = { width: 320, height: 160 }

describe('tour steps', () => {
  it('opens with a centred welcome and has unique ids and sentence-case titles', () => {
    expect(TOUR_STEPS[0].target).toBeNull()
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(TOUR_STEPS.length)
    for (const step of TOUR_STEPS) {
      expect(step.title[0]).toBe(step.title[0].toUpperCase())
      expect(step.title.split(/\s+/).filter((word) => /^[A-Z]{2,}$/.test(word))).toEqual([])
    }
  })

  it('names the shortcut on every step that has one', () => {
    for (const id of ['camera', 'time', 'passes', 'modules', 'settings']) {
      expect(TOUR_STEPS.find((step) => step.id === id)?.body).toMatch(/Keys?: /)
    }
  })
})

describe('spotlightBox', () => {
  it('pads the target and stays inside the viewport', () => {
    expect(spotlightBox({ left: 100, top: 100, width: 50, height: 20 }, viewport, 8))
      .toEqual({ left: 92, top: 92, width: 66, height: 36 })
    const corner = spotlightBox({ left: 1330, top: 0, width: 36, height: 30 }, viewport, 8)
    expect(corner.left + corner.width).toBeLessThanOrEqual(viewport.width)
    expect(corner.top).toBeGreaterThanOrEqual(0)
  })
})

describe('placeCard', () => {
  const inside = (p: { left: number; top: number }): void => {
    expect(p.left).toBeGreaterThanOrEqual(CARD_GAP)
    expect(p.top).toBeGreaterThanOrEqual(CARD_GAP)
    expect(p.left + card.width).toBeLessThanOrEqual(viewport.width - CARD_GAP)
    expect(p.top + card.height).toBeLessThanOrEqual(viewport.height - CARD_GAP)
  }

  it('centres without a spotlight', () => {
    expect(placeCard(null, card, viewport)).toEqual({ left: 523, top: 304 })
  })

  it('goes below a top control, clamped to the right edge', () => {
    const spot = { left: 1200, top: 10, width: 150, height: 40 }
    const p = placeCard(spot, card, viewport)
    expect(p.top).toBe(spot.top + spot.height + CARD_GAP)
    inside(p)
  })

  it('goes above a bottom control', () => {
    const spot = { left: 500, top: 660, width: 360, height: 90 }
    const p = placeCard(spot, card, viewport)
    expect(p.top + card.height).toBe(spot.top - CARD_GAP)
    inside(p)
  })

  it('goes beside a target too tall for either, on the wider side', () => {
    const spot = { left: 20, top: 100, width: 300, height: 560 }
    const p = placeCard(spot, card, viewport)
    expect(p.left).toBe(spot.left + spot.width + CARD_GAP)
    inside(p)
  })

  it('stays on screen on a small phone', () => {
    const phone = { width: 360, height: 640 }
    const p = placeCard({ left: 250, top: 80, width: 100, height: 48 }, { width: 336, height: 180 }, phone)
    expect(p.left).toBe(CARD_GAP)
    expect(p.left + 336).toBeLessThanOrEqual(phone.width - CARD_GAP)
  })
})

describe('tour seen flag', () => {
  it('round-trips through storage', () => {
    const map = new Map<string, string>()
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
    expect(readTourSeen(storage)).toBe(false)
    markTourSeen(storage)
    expect(map.get(TOUR_SEEN_KEY)).toBe('1')
    expect(readTourSeen(storage)).toBe(true)
  })

  it('treats missing or throwing storage as unseen, without throwing', () => {
    const throwing = {
      getItem: (): string | null => { throw new Error('SecurityError') },
      setItem: (): void => { throw new Error('QuotaExceededError') },
    }
    expect(readTourSeen(null)).toBe(false)
    expect(readTourSeen(throwing)).toBe(false)
    expect(() => markTourSeen(throwing)).not.toThrow()
  })
})
