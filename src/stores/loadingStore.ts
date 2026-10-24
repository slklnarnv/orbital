import { create } from 'zustand'

import type { IssModelQuality } from './settingsStore'

// ─── ISS detail lifecycle (single authority — plan 001 phase E) ──────────────
//
// The store describes ONE thing: the lifecycle of the deferred detail-model
// candidate. Every field is explicit so ownership is enforceable:
//   status        — where the candidate attempt is in its lifecycle
//   quality       — which asset the CURRENT attempt loads. The high setting is
//                   loaded in two tiers: 'locate' (a fast, silhouetted IGOAL
//                   LOD) first, then 'high' (the full asset) when the camera
//                   enters Inspect. 'legacy' is the fallback detailed model.
//   attempt       — monotonic attempt identity; every completing callback
//                   carries the attempt it belongs to, and transitions from a
//                   stale attempt are ignored (obsolete preparations can never
//                   publish readiness for a different request)
//   activeQuality — the quality whose model is COMMITTED and displayed. It
//                   survives a pending replacement: the committed model stays
//                   on screen while a different candidate prepares.
//
// status transitions:
//   idle ──requestISSDetail──> loading ──prepare──> preparing ──> ready
//   failed ──requestISSDetail──> loading            (retry after failure)
//   selection change ──beginISSDetailAttempt──> loading (from any non-terminal state)
//   unavailable — terminal for the session: Model A itself failed, so no ISS
//   group can exist. requestISSDetail() deliberately does not retry it.

export type IssDetailStatus =
  | 'idle'
  | 'loading'
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'unavailable'

/** Detailed-model tiers. `locate` is the fast IGOAL LOD (Locate/Follow);
 *  `high` is the full asset (Inspect); `legacy` is the fallback detailed
 *  model. The user-facing setting remains `IssModelQuality` (high | legacy). */
export type DetailQuality = IssModelQuality | 'locate'

export interface IssDetailState {
  status: IssDetailStatus
  quality: DetailQuality | null
  activeQuality: DetailQuality | null
  attempt: number
}

/** A committed detailed tier (locate, high or legacy) is enough for Locate to
 *  depart; a pending higher tier must not stall the flight. */
export function hasCommittedDetail(detail: IssDetailState): boolean {
  return detail.activeQuality !== null
}

/** True only while a Locate must wait for the FIRST usable detailed tier. */
export function shouldAwaitDetail(detail: IssDetailState): boolean {
  return !hasCommittedDetail(detail)
    && detail.status !== 'ready'
    && detail.status !== 'failed'
    && detail.status !== 'unavailable'
}

interface LoadingStore {
  issDetail: IssDetailState
  /** Prewarm / Locate intent: starts a load if none is running. */
  requestISSDetail: () => void
  /** Record a new candidate attempt for `quality` (bumps the attempt). */
  beginISSDetailAttempt: (quality: DetailQuality) => number
  /** Record the requested identity without loading (mount-time disclosure). */
  identifyISSDetail: (quality: DetailQuality) => void
  /** Attempt-guarded transitions; stale attempts are ignored. */
  setIssDetailPreparing: (attempt: number) => void
  commitISSDetailReady: (attempt: number) => void
  failISSDetailAttempt: (attempt: number) => void
  /** Model A itself failed: no ISS group can exist this session (terminal). */
  markISSUnavailable: () => void
  /** Unmount-time reset back to the pristine state. */
  resetIssDetail: () => void
}

export const useLoadingStore = create<LoadingStore>((set) => ({
  issDetail: { status: 'idle', quality: null, activeQuality: null, attempt: 0 },

  requestISSDetail: () => set((state) => {
    // A usable detailed tier is already committed: hover/focus must not start
    // a higher-tier download. Tier upgrades are explicit (Inspect entry or an
    // explicit reselect), so a failed full-high attempt cannot be retried by
    // merely hovering Locate at Follow.
    if (state.issDetail.activeQuality !== null) return state
    return state.issDetail.status === 'idle' || state.issDetail.status === 'failed'
      ? { issDetail: { ...state.issDetail, status: 'loading' } }
      : state
  }),

  beginISSDetailAttempt: (quality) => {
    let attempt = 0
    set((state) => {
      // `unavailable` is terminal: Model A failed, so no ISS group can exist and
      // a new detail attempt must not revive it.
      if (state.issDetail.status === 'unavailable') {
        attempt = state.issDetail.attempt
        return state
      }
      attempt = state.issDetail.attempt + 1
      return { issDetail: { ...state.issDetail, status: 'loading', quality, attempt } }
    })
    return attempt
  },

  identifyISSDetail: (quality) => set((state) => (
    state.issDetail.quality === quality
      ? state
      : { issDetail: { ...state.issDetail, quality, attempt: state.issDetail.attempt + 1 } }
  )),

  setIssDetailPreparing: (attempt) => set((state) => (
    state.issDetail.attempt === attempt && state.issDetail.status === 'loading'
      ? { issDetail: { ...state.issDetail, status: 'preparing' } }
      : state
  )),

  commitISSDetailReady: (attempt) => set((state) => (
    state.issDetail.attempt === attempt
      ? { issDetail: { ...state.issDetail, status: 'ready', activeQuality: state.issDetail.quality } }
      : state
  )),

  failISSDetailAttempt: (attempt) => set((state) => (
    state.issDetail.attempt === attempt
      ? { issDetail: { ...state.issDetail, status: 'failed' } }
      : state
  )),

  markISSUnavailable: () => set((state) => (
    state.issDetail.status === 'unavailable' ? state : { issDetail: { ...state.issDetail, status: 'unavailable' } }
  )),

  resetIssDetail: () => set({ issDetail: { status: 'idle', quality: null, activeQuality: null, attempt: 0 } }),
}))
