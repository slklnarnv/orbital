import { create } from 'zustand'

import { EMPTY_ASSET_SNAPSHOT, type AssetSnapshot } from '@/ui/loading/bootProgress'

/**
 * Boot progress for the loading screen (plan 017 I2). `assets` is published by
 * the asset-load tracker (src/ui/loading/assetLoadTracker.ts) at most once per
 * microtask; `linkSettled` flips when the telemetry bootstrap (cache read plus
 * first live fetch) has finished, whatever its outcome.
 */
interface BootStore {
  assets: AssetSnapshot
  linkSettled: boolean
}

export const useBootStore = create<BootStore>(() => ({
  assets: EMPTY_ASSET_SNAPSHOT,
  linkSettled: false,
}))

export function markLinkSettled(): void {
  useBootStore.setState({ linkSettled: true })
}
