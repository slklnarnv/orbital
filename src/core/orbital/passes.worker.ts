import * as satellite from 'satellite.js'
import { findVisiblePasses, type Observer, type VisiblePass } from './PassPredictor'

// Off-main-thread visible-pass search (roadmap B.3). One request, one reply;
// the client (PassService) matches replies by id and drops stale ones.

export interface PassRequest {
  id: number
  line1: string
  line2: string
  observer: Observer
  fromMs: number
}

export type PassResponse =
  | { id: number; passes: VisiblePass[] }
  | { id: number; error: string }

/** Shared by the worker and the main-thread fallback. */
export function runPassRequest(request: PassRequest): PassResponse {
  try {
    const satrec = satellite.twoline2satrec(request.line1, request.line2)
    if (satrec.error !== 0) throw new Error(`TLE parse error ${satrec.error}`)
    return { id: request.id, passes: findVisiblePasses(satrec, request.observer, request.fromMs) }
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) }
  }
}

// Only wire the message handler inside a worker (no `window`); importing this
// module on the main thread for the fallback must not install it.
if (typeof window === 'undefined' && typeof self !== 'undefined') {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<PassRequest>) => void) | null
    postMessage: (message: PassResponse) => void
  }
  scope.onmessage = (event) => scope.postMessage(runPassRequest(event.data))
}
