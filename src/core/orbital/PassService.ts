import type { Observer, VisiblePass } from './PassPredictor'
import { runPassRequest, type PassRequest, type PassResponse } from './passes.worker'

// ─── Visible-pass service (roadmap B.3) ──────────────────────────────────────
//
// Runs findVisiblePasses in a module Web Worker so a 48 h scan never competes
// with the render loop. If the worker cannot start (an old browser, a
// stricter CSP), the same function runs on the main thread — it takes ~10 ms,
// so the fallback is acceptable, just not preferred.

/** Recompute once the window has slid this far: the list still covers 42 h. */
export const PASS_RECOMPUTE_AFTER_MS = 6 * 3_600_000
/** A seek further back than this invalidates the list. */
const SEEK_BACK_SLACK_MS = 60_000

export interface PassComputeKey {
  fromMs: number
  tleKey: string
  observerKey: string
}

/**
 * Whether a list computed at `previous` is stale at `simMs`: a different
 * element set or observer, a seek backwards, or a window slid past
 * PASS_RECOMPUTE_AFTER_MS.
 */
export function needsPassRecompute(
  previous: PassComputeKey | null,
  simMs: number,
  tleKey: string,
  observerKey: string,
): boolean {
  if (!previous) return true
  if (previous.tleKey !== tleKey || previous.observerKey !== observerKey) return true
  if (simMs < previous.fromMs - SEEK_BACK_SLACK_MS) return true
  return simMs - previous.fromMs > PASS_RECOMPUTE_AFTER_MS
}

export function observerKeyOf(observer: Observer): string {
  return `${observer.latitudeDeg.toFixed(4)},${observer.longitudeDeg.toFixed(4)}`
}

class PassService {
  private worker: Worker | null = null
  private workerFailed = false
  private nextId = 1
  private readonly pending = new Map<number, { request: PassRequest; resolve: (response: PassResponse) => void }>()

  compute(line1: string, line2: string, observer: Observer, fromMs: number): Promise<VisiblePass[]> {
    const request: PassRequest = { id: this.nextId++, line1, line2, observer, fromMs }
    return new Promise<PassResponse>((resolve) => {
      const worker = this.ensureWorker()
      if (!worker) {
        resolve(runPassRequest(request))
        return
      }
      this.pending.set(request.id, { request, resolve })
      worker.postMessage(request)
    }).then((response) => {
      if ('error' in response) throw new Error(response.error)
      return response.passes
    })
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.workerFailed) return this.worker
    if (typeof Worker === 'undefined') {
      this.workerFailed = true
      return null
    }
    try {
      const worker = new Worker(new URL('./passes.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<PassResponse>) => {
        const entry = this.pending.get(event.data.id)
        this.pending.delete(event.data.id)
        entry?.resolve(event.data)
      }
      worker.onerror = () => this.failOver()
      this.worker = worker
    } catch {
      this.workerFailed = true
    }
    return this.worker
  }

  /** The worker died: answer what was in flight, and everything after, on the main thread. */
  private failOver(): void {
    this.worker?.terminate()
    this.worker = null
    this.workerFailed = true
    for (const { request, resolve } of this.pending.values()) resolve(runPassRequest(request))
    this.pending.clear()
  }
}

export const passService = new PassService()
