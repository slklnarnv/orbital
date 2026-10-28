// ─── hudStore.test.ts — one flag for hiding the HUD and the scene annotations ─

import { afterEach, describe, expect, it } from 'vitest'

import { useHudStore } from '@/stores/hudStore'

afterEach(() => useHudStore.getState().setHidden(false))

describe('useHudStore', () => {
  it('starts visible and toggles the flag the orbit line and ground track read', () => {
    expect(useHudStore.getState().hidden).toBe(false)
    useHudStore.getState().setHidden(true)
    expect(useHudStore.getState().hidden).toBe(true)
    useHudStore.getState().setHidden(false)
    expect(useHudStore.getState().hidden).toBe(false)
  })

  it('needs no DOM (node: the class mirror is skipped)', () => {
    expect(typeof document).toBe('undefined')
    expect(() => useHudStore.getState().setHidden(true)).not.toThrow()
  })
})
