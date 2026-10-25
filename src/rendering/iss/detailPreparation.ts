import * as THREE from 'three'

/** Minimal renderer surface used by preparation (a fake in tests). */
export interface PreparationRenderer {
  getRenderTarget(): THREE.WebGLRenderTarget | null
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void
}

/**
 * three keys tone mapping and output colour space on the CURRENT render
 * target (ACES + sRGB only when it is null). With the bloom composer active,
 * RenderPass draws the scene into a HalfFloat target, so warming programs
 * against the default framebuffer compiles a variant the composer never
 * uses. Run `work` with an equivalent offscreen target bound, then restore.
 */
export function withPreparationTarget<T>(
  gl: PreparationRenderer,
  target: THREE.WebGLRenderTarget | null,
  work: () => T,
): T {
  if (!target) return work()
  const previous = gl.getRenderTarget()
  gl.setRenderTarget(target)
  try {
    return work()
  } finally {
    gl.setRenderTarget(previous)
  }
}

/** A 1×1 HalfFloat target matching the composer's colour format. */
export function createPreparationTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
}

/**
 * Number of a GLTF's textures that failed to load. three-stdlib's GLTFParser
 * resolves a failed texture to null and finishes the model without it, so a
 * broken KTX2 transcoder would otherwise "succeed" as an untextured grey
 * station. Detail preparation treats any miss as a failed attempt, which
 * demotes to the next model on the reliability ladder.
 */
export function countMissingTextures(textures: ReadonlyArray<unknown>): number {
  return textures.filter((texture) => texture === null || texture === undefined).length
}
