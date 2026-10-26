import { DefaultLoadingManager, type LoadingManager } from 'three'

import { useBootStore } from '@/stores/bootStore'

import { AssetLoadTally } from './bootProgress'

const INSTALLED = Symbol.for('orbital.assetLoadTracker')

type TrackedManager = LoadingManager & { [INSTALLED]?: true }

/**
 * Wraps the manager's per-item hooks so the loading screen can tell which
 * files are in flight. The callbacks (onStart/onProgress/onLoad/onError) stay
 * free for drei and ISSModel; this only adds bookkeeping in front of the
 * originals. Idempotent, so a dev HMR re-evaluation cannot double-count.
 *
 * Loaders start inside React render (suspense), so publishing is deferred to a
 * microtask: a store update during another component's render is a React error.
 */
export function installAssetLoadTracker(manager: LoadingManager = DefaultLoadingManager): void {
  const tracked = manager as TrackedManager
  if (tracked[INSTALLED]) return
  tracked[INSTALLED] = true

  const tally = new AssetLoadTally()
  let scheduled = false
  const publish = (): void => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      useBootStore.setState({ assets: tally.snapshot() })
    })
  }

  const { itemStart, itemEnd, itemError } = manager
  manager.itemStart = (url: string) => {
    tally.itemStart(url)
    publish()
    itemStart.call(manager, url)
  }
  manager.itemEnd = (url: string) => {
    tally.itemEnd(url)
    publish()
    itemEnd.call(manager, url)
  }
  manager.itemError = (url: string) => {
    tally.itemError(url)
    publish()
    itemError.call(manager, url)
  }
}

// Installed on import: main.tsx imports this module first, before the scene
// modules whose top-level useTexture/useGLTF.preload calls start the requests.
installAssetLoadTracker()
