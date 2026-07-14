import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLOUD_RADIUS, EARTH_RADIUS } from '@/rendering/earth/EarthConstants'

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

describe('Earth visual shader output', () => {
  for (const shader of [
    'src/rendering/shaders/earthSurface.frag',
    'src/rendering/shaders/clouds.frag',
    'src/rendering/shaders/atmosphere.frag',
  ]) {
    it(`${shader} uses the renderer tone and color pipeline`, () => {
      const source = read(shader)

      expect(source).toContain('#include <tonemapping_fragment>')
      expect(source).toContain('#include <colorspace_fragment>')
      expect(source.indexOf('#include <tonemapping_fragment>'))
        .toBeLessThan(source.indexOf('#include <colorspace_fragment>'))
    })
  }
})

describe('cloud-shell separation contract', () => {
  it('keeps a physically visible gap above the terrain shell', () => {
    expect(CLOUD_RADIUS - EARTH_RADIUS).toBeGreaterThan(15)
  })

  it('keeps clouds on one elevated, depth-biased shell', () => {
    const source = read('src/rendering/earth/CloudLayer.tsx')

    expect(source).toContain('args={[CLOUD_RADIUS, EARTH_SPHERE_SEGMENTS, EARTH_SPHERE_SEGMENTS]}')
    expect(source).toContain('depthWrite={false}')
    expect(source).toContain('depthTest={true}')
    expect(source).toContain('polygonOffset={true}')
    expect(source).toContain('side={THREE.FrontSide}')
    expect(read('src/rendering/shaders/clouds.frag')).toContain('proximityFade')
  })
})
