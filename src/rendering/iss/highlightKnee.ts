import * as THREE from 'three'

/**
 * Station highlight knee: keeps every station fragment under the bloom
 * threshold, the way the sun already is (sun.frag, SunGlareBudget.test.ts).
 *
 * UnrealBloom resolves its coarsest mip at 1/16 of the frame, so a compact
 * HDR source blooms as a rounded square. The sun was kept out of that path,
 * but the station's specular glints were not: with the sun light at 1.9, a
 * surface of roughness ~0.3 seen at its mirror angle reflects ~9 (linear),
 * and because every point of a flat panel shares one normal, the whole
 * panel flashes at once — a white square with a square halo between the
 * array wings. Below KNEE_START nothing changes; above it the peak channel
 * rolls off exponentially toward KNEE_CEILING, so a glint still blows out to
 * white after tone mapping but never reaches the bloom pass.
 */
export const KNEE_START = 1.8
export const KNEE_CEILING = 2.3

/** The knee on one value (JS mirror of the GLSL, for tests and budgets). */
export function highlightKnee(peak: number): number {
  if (peak <= KNEE_START) return peak
  const span = KNEE_CEILING - KNEE_START
  return KNEE_START + span * (1 - Math.exp(-(peak - KNEE_START) / span))
}

export const HIGHLIGHT_KNEE_GLSL = /* glsl */ `
{
  // Orbital highlight knee (src/rendering/iss/highlightKnee.ts).
  float orbitalPeak = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
  if (orbitalPeak > ${KNEE_START.toFixed(4)}) {
    float orbitalSpan = ${(KNEE_CEILING - KNEE_START).toFixed(4)};
    float orbitalKnee = ${KNEE_START.toFixed(4)} + orbitalSpan * (1.0 - exp(-(orbitalPeak - ${KNEE_START.toFixed(4)}) / orbitalSpan));
    outgoingLight *= orbitalKnee / orbitalPeak;
  }
}
`

const PROGRAM_KEY = 'orbital-highlight-knee'

// A WeakSet, not userData: Material.clone() copies userData but not
// onBeforeCompile, so a flag there would mark unpatched copies as done.
const patched = new WeakSet<THREE.Material>()

/**
 * Add the knee to a lit station material (idempotent). Applied to the shared
 * materials of every station tier and to the explorer's highlight copies, so
 * a copy keeps the same program key and costs no shader compile.
 */
export function applyHighlightKnee(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial) || patched.has(material)) return
  patched.add(material)
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `${HIGHLIGHT_KNEE_GLSL}\n#include <opaque_fragment>`,
    )
  }
  material.customProgramCacheKey = () => PROGRAM_KEY
  material.needsUpdate = true
}

/** Apply the knee to every material under `root`. */
export function applyHighlightKneeTo(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) applyHighlightKnee(material)
  })
}
