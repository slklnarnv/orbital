import { beforeEach, describe, expect, it } from 'vitest'
import {
  closeOverlay,
  isModalOpen,
  openOverlay,
  switchOverlay,
  toggleOverlay,
  useOverlayStore,
} from '@/ui/overlay/overlay'

// Roadmap 017 A1/A2/P: one overlay system for the popovers, About and the
// help overlay. These pin the state rules; focus return needs a DOM and is
// covered by the Playwright spec.

describe('overlay store', () => {
  beforeEach(() => useOverlayStore.setState({ open: null, returnTo: null, focusIn: false }))

  it('keeps one overlay open at a time', () => {
    openOverlay('settings')
    openOverlay('passes')
    expect(useOverlayStore.getState().open).toBe('passes')
  })

  it('toggles: a second press closes', () => {
    toggleOverlay('settings', { focusIn: true })
    expect(useOverlayStore.getState()).toMatchObject({ open: 'settings', focusIn: true })
    toggleOverlay('settings')
    expect(useOverlayStore.getState().open).toBeNull()
  })

  it('a pointer open leaves focus where it is', () => {
    openOverlay('about')
    expect(useOverlayStore.getState().focusIn).toBe(false)
  })

  it('About → shortcuts returns to the About trigger', () => {
    openOverlay('about')
    switchOverlay('help')
    expect(useOverlayStore.getState()).toMatchObject({ open: 'help', returnTo: 'about', focusIn: true })
  })

  it('treats only the help overlay as modal', () => {
    openOverlay('settings')
    expect(isModalOpen()).toBe(false)
    openOverlay('help')
    expect(isModalOpen()).toBe(true)
  })

  it('closes safely with nothing open and without a DOM', () => {
    expect(() => closeOverlay()).not.toThrow()
    openOverlay('seek')
    closeOverlay()
    expect(useOverlayStore.getState().open).toBeNull()
  })
})
