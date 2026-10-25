import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js'
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js'

/**
 * Scene pass for the Bloom composer that keeps multisampling to the one pass
 * that has geometry edges.
 *
 * The composer used to own a 4× MSAA HalfFloat target. UnrealBloomPass blends
 * its result back into that target (a full-screen quad into four samples per
 * pixel) and three then resolved it a second time — color AND depth both
 * times, though nothing reads the depth. On the integrated GPU this measured
 * 18.5 ms of GPU time per frame (~5 ms scene, ~5 ms bloom blend, ~5.6 ms of
 * resolves), so Follow ran at ~56 fps with Bloom on and 60 with it off.
 *
 * Here only the scene draws into a private MSAA target; it resolves color
 * only (`resolveDepthBuffer = false` also lets the driver discard the depth
 * samples) and is copied once into the composer's single-sample read buffer.
 * Every later pass (bloom, flare, output) runs on single-sample targets. A
 * full-screen quad writes the same value to every sample, so the bloom blend
 * after the resolve equals the blend before it.
 */
export class MultisampleRenderPass extends Pass {
  readonly target: THREE.WebGLRenderTarget
  private readonly copyMaterial: THREE.ShaderMaterial
  private readonly quad: FullScreenQuad

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    samples: number,
  ) {
    super()
    // Like RenderPass: draw into the read buffer, no swap.
    this.needsSwap = false
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples })
    this.target.texture.name = 'MultisampleRenderPass.scene'
    this.target.resolveDepthBuffer = false
    this.copyMaterial = new THREE.ShaderMaterial({
      name: 'CopyShader',
      uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
      vertexShader: CopyShader.vertexShader,
      fragmentShader: CopyShader.fragmentShader,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    })
    this.copyMaterial.uniforms.tDiffuse.value = this.target.texture
    this.quad = new FullScreenQuad(this.copyMaterial)
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(width, height)
  }

  override render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(this.target)
    renderer.clear()
    // render() resolves the multisampled target into target.texture at its end.
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer)
    this.quad.render(renderer)
    renderer.autoClear = autoClear
  }

  override dispose(): void {
    this.target.dispose()
    this.copyMaterial.dispose()
    this.quad.dispose()
  }
}
