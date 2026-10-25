// ─── BasisTranscoderUrl.test.ts — cache-busting the KTX2 transcoder ──────────
//
// The transcoder is fetched by fixed names; versioning them keeps returning
// visitors from running a cached, outdated transcoder after a deploy.

import { describe, expect, it } from 'vitest'

import { BASIS_TRANSCODER_PATH, versionTranscoderUrl } from '@/rendering/iss/basisTranscoderUrl'

describe('versionTranscoderUrl', () => {
  it('versions both transcoder files', () => {
    expect(versionTranscoderUrl(`${BASIS_TRANSCODER_PATH}basis_transcoder.js`, 'abc123'))
      .toBe('/basis/basis_transcoder.js?v=abc123')
    expect(versionTranscoderUrl(`${BASIS_TRANSCODER_PATH}basis_transcoder.wasm`, 'abc123'))
      .toBe('/basis/basis_transcoder.wasm?v=abc123')
  })

  it('leaves embedded-texture blob URLs and other paths untouched', () => {
    const blob = 'blob:https://orbitaliss.vercel.app/4fc6ecc0-bf7d-40a8-ae3b-ee5fc5b9aa75'
    expect(versionTranscoderUrl(blob, 'abc123')).toBe(blob)
    expect(versionTranscoderUrl('/models/iss_igoal_locate.glb?v=1', 'abc123')).toBe('/models/iss_igoal_locate.glb?v=1')
  })
})
