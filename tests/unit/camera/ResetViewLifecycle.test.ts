import { afterEach, describe, expect, it } from 'vitest'
import { useCameraStore } from '@/stores/cameraStore'
import { useLoadingStore } from '@/stores/loadingStore'

afterEach(() => {
  useCameraStore.setState(useCameraStore.getInitialState(), true)
  useLoadingStore.setState(useLoadingStore.getInitialState(), true)
})

describe('Reset View lifecycle', () => {
  it('finishes in Earth navigation instead of retaining ISS tracking', () => {
    useCameraStore.getState().setMode('FOLLOW')
    useCameraStore.getState().triggerResetView(25000)
    useCameraStore.getState().completeTransition()
    expect(useCameraStore.getState()).toMatchObject({
      mode: 'ORBITAL', isTracking: false, isTransitioning: false,
    })
  })

  it('restores the current mode when reset is cancelled before departure', () => {
    useCameraStore.getState().setMode('FOLLOW')
    useCameraStore.getState().triggerResetView(25000)
    useCameraStore.getState().cancelTransition()
    // A late completion must not turn a cancelled reset into Earth navigation.
    useCameraStore.getState().completeTransition()
    expect(useCameraStore.getState()).toMatchObject({
      mode: 'FOLLOW', isTracking: true, isTransitioning: false, transition: null,
    })
  })
})

describe('Locate lifecycle', () => {
  it('flies from an untracked view', () => {
    const store = useCameraStore.getState()
    store.setMode('FREE')
    store.triggerLocateISS()
    expect(useCameraStore.getState()).toMatchObject({
      isTransitioning: true, isTracking: false,
    })
    useCameraStore.getState().cancelTransition()
  })

  it('re-flies when pressed while tracking, like Reset View', () => {
    const store = useCameraStore.getState()
    store.setMode('INSPECT')
    store.triggerLocateISS()
    expect(useCameraStore.getState()).toMatchObject({
      isTransitioning: true, transition: { toMode: 'FOLLOW' },
    })
    useCameraStore.getState().cancelTransition()
  })

  it('re-captures an in-flight transition when triggered again', () => {
    const store = useCameraStore.getState()
    store.setMode('ORBITAL')
    store.triggerLocateISS()
    const first = useCameraStore.getState().transition
    store.triggerResetView(25000)
    const second = useCameraStore.getState().transition
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    expect(second?.toMode).toBe('ORBITAL')
    useCameraStore.getState().cancelTransition()
  })

  it('leaves the home view on any user deviation and reports it back', () => {
    expect(useCameraStore.getState().isHomeView).toBe(true)
    useCameraStore.getState().setHomeView(false)
    expect(useCameraStore.getState().isHomeView).toBe(false)
    useCameraStore.getState().setHomeView(false)
    expect(useCameraStore.getState().isHomeView).toBe(false)
    useCameraStore.getState().setHomeView(true)
    expect(useCameraStore.getState().isHomeView).toBe(true)
  })
})
