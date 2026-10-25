/** Where the self-hosted Basis transcoder lives (public/basis/). */
export const BASIS_TRANSCODER_PATH = '/basis/'

/**
 * Version the transcoder files with their content hash (`__BASIS_ID__`).
 *
 * KTX2Loader fetches `basis_transcoder.js` / `.wasm` by fixed names, so a
 * changed transcoder would otherwise reach returning visitors only after
 * their HTTP cache expired. That happened with the CSP fix: browsers that
 * had cached three's stock glue kept running it (and hanging) for up to an
 * hour after the deploy. Every other URL the loader sees — the blob: URLs of
 * a GLB's embedded textures — passes through untouched.
 */
export function versionTranscoderUrl(url: string, version: string): string {
  return url.startsWith(BASIS_TRANSCODER_PATH) ? `${url}?v=${version}` : url
}
