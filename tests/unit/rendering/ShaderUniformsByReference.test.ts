// ─── ShaderUniformsByReference.test.ts — uniforms reach the GPU ─────────────
//
// R3F 9 applies a `uniforms` prop on <shaderMaterial> by copying each uniform
// into new objects. Our components write textures and sun positions into
// their own uniform objects after mount, so with the prop those writes never
// reached the material: the Earth rendered black on 2026-10-28 (#55). The
// uniforms go in through the constructor (`args`) instead, which three keeps
// by reference. This test keeps the prop from coming back.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return full.endsWith('.tsx') ? [full] : []
  })
}

describe('shader uniforms', () => {
  it('never passes uniforms as a JSX prop', () => {
    const offenders = sources('src').filter((file) => /\buniforms=\{/.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('passes them through memoized constructor args where materials are declared', () => {
    for (const file of [
      'src/rendering/earth/EarthSurface.tsx',
      'src/rendering/earth/CloudLayer.tsx',
      'src/rendering/earth/AtmosphereShell.tsx',
      'src/rendering/iss/ISSModel.tsx',
      'src/rendering/scene/EnvironmentLayer.tsx',
    ]) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).toMatch(/const materialArgs = useMemo<\[THREE\.ShaderMaterialParameters\]>/)
      expect(source, file).toContain('args={materialArgs}')
    }
  })
})
