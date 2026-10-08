import { create } from 'zustand'

import type { IssModelQuality } from './settingsStore'

// ─── ISS detail lifecycle (single authority — plan 001 phase E) ──────────────
//
// The store describes ONE thing: the lifecycle of the deferred detail-model
// candidate. Every field is explicit so ownership is enforceable:
//   status        — where the candidate attempt is in its lifecycle
//   quality       — which asset the CURRENT attempt loads
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

export interface IssDetailState {
  status: IssDetailStatus
  quality: IssModelQuality | null
  activeQuality: IssModelQuality | null
  attempt: number
}

interface LoadingStore {
  issDetail: IssDetailState
  /** Prewarm / Locate intent: starts a load if none is running. */
  requestISSDetail: () => void
  /** Record a new candidate attempt for `quality` (bumps the attempt). */
  beginISSDetailAttempt: (quality: IssModelQuality) => number
  /** Record the requested identity without loading (mount-time disclosure). */
  identifyISSDetail: (quality: IssModelQuality) => void
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

  requestISSDetail: () => set((state) => (
    state.issDetail.status === 'idle' || state.issDetail.status === 'failed'
      ? { issDetail: { ...state.issDetail, status: 'loading' } }
      : state
  )),

  beginISSDetailAttempt: (quality) => {
    let attempt = 0
    set((state) => {
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
