// ─── Orbit line material ──────────────────────────────────────────────────────
//
// three's LineMaterial (fat screen-space line) with two injections, spliced
// in by onBeforeCompile against the installed three r170 sources:
//   - per-vertex alpha (`instanceAlphaStart/End`), mirroring the built-in
//     instanceColorStart/End — LineMaterial has none of its own;
//   - the dash (`shaders/orbitDash.glsl`), keyed on the orbital phase that
//     rides in LineMaterial's own instanceDistanceStart/End slots. USE_DASH
//     stays compiled in for that varying and for its endcap discard (round
//     per-segment caps would double-blend at every joint). The built-in
//     `mod(vLineDistance + dashOffset, …)` test is replaced, so dashOffset,
//     dashSize and gapSize are unused.
// The Dashed/Continuous setting is the `orbitDashed` uniform: switching
// never recompiles the program.

import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

import orbitDashChunk from '../shaders/orbitDash.glsl'

/** ISS orbital track color — pale cornflower blue (#93C5FD). */
const ORBIT_COLOR = 0x93c5fd

/** Screen-space stroke width in pixels. */
const LINE_WIDTH_PX = 2.0

const VERTEX_EDITS: Array<[string, string]> = [
  ['attribute vec3 instanceEnd;', `attribute vec3 instanceEnd;
attribute float instanceAlphaStart;
attribute float instanceAlphaEnd;
varying float vInstanceAlpha;
varying float vSegmentPhase;
varying vec3 vOrbitClip;`],
  ['float aspect = resolution.x / resolution.y;', `vInstanceAlpha = ( position.y < 0.5 ) ? instanceAlphaStart : instanceAlphaEnd;
vSegmentPhase = instanceDistanceEnd - instanceDistanceStart;
float aspect = resolution.x / resolution.y;`],
  ['gl_Position = clip;', `gl_Position = clip;
vOrbitClip = clip.xyw;`],
]

// The derivatives are taken at the top of main(), before any discard, so
// every pixel of a quad still has them.
const FRAGMENT_EDITS: Array<[string, string]> = [
  ['varying float vLineDistance;', `varying float vLineDistance;
varying float vInstanceAlpha;
varying float vSegmentPhase;
varying vec3 vOrbitClip;
uniform vec2 resolution;
uniform float orbitDashed;`],
  ['void main() {', `${orbitDashChunk}
void main() {
  // Phase per CSS pixel along the line: vUv.y runs -1 → 1 along a segment
  // while the phase advances by vSegmentPhase, and NDC x converts device to
  // CSS pixels, so the pitch holds under any DPR or composer target.
  float orbitNdcX = vOrbitClip.x / vOrbitClip.z;
  float orbitCssPerDevicePx = 0.5 * resolution.x * length( vec2( dFdx( orbitNdcX ), dFdy( orbitNdcX ) ) );
  float orbitPhasePerPx = 0.5 * abs( vSegmentPhase ) * length( vec2( dFdx( vUv.y ), dFdy( vUv.y ) ) )
    / max( orbitCssPerDevicePx, 1e-6 );
  float orbitDash = orbitDashed > 0.5 ? orbitDashMask( vLineDistance, orbitPhasePerPx ) : 1.0;`],
  ['if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX',
    'if ( orbitDash <= 0.0 ) discard;'],
  ['gl_FragColor = vec4( diffuseColor.rgb, alpha );',
    'gl_FragColor = vec4( diffuseColor.rgb, alpha * vInstanceAlpha * orbitDash );'],
]

function applyEdits(source: string, edits: Array<[string, string]>): string {
  return edits.reduce((out, [anchor, replacement]) => {
    if (!out.includes(anchor)) throw new Error(`orbitLineMaterial: LineMaterial anchor missing: ${anchor}`)
    return out.replace(anchor, replacement)
  }, source)
}

/** The orbit line's material; set `uniforms.orbitDashed.value` to 1 or 0. */
export function createOrbitLineMaterial(): LineMaterial {
  const material = new LineMaterial({
    color: ORBIT_COLOR,
    linewidth: LINE_WIDTH_PX,
    transparent: true,
    depthWrite: false, // Don't occlude ISS model or atmosphere shell
    depthTest: true,   // Line is hidden where Earth blocks it (physically correct)
    blending: THREE.NormalBlending,
    dashed: true,      // USE_DASH, permanently (see the header)
  })
  material.uniforms.orbitDashed = { value: 1 }
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = applyEdits(shader.vertexShader, VERTEX_EDITS)
    shader.fragmentShader = applyEdits(shader.fragmentShader, FRAGMENT_EDITS)
  }
  return material
}
