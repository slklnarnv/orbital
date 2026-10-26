import { describe, expect, it } from 'vitest'
import { EARTH_8K_SOURCES, earthKtxArgs } from '../../../scripts/build-earth-8k.mjs'
import { ktxCreateArgs } from '../../../scripts/build-iss-model.mjs'

describe('8K Earth build (plan 017 V2)', () => {
  it('encodes the night lights exactly like the ISS colour textures (ETC1S)', () => {
    expect(earthKtxArgs('etc1s', 'in.png', 'out.ktx2')).toEqual(
      ktxCreateArgs({ color: true, data: false, alpha: false }, 'in.png', 'out.ktx2'),
    )
  })

  it('encodes the day map as sRGB UASTC with mipmaps', () => {
    const args = earthKtxArgs('uastc', 'in.png', 'out.ktx2').join(' ')
    expect(args).toMatch(/--format R8G8B8_SRGB/)
    expect(args).toMatch(/--encode uastc/)
    expect(args).toMatch(/--generate-mipmap in\.png out\.ktx2$/)
  })

  it('pins public-domain NASA sources by hash', () => {
    expect(EARTH_8K_SOURCES.map((s) => [s.name, s.codec])).toEqual([['day', 'uastc'], ['night', 'etc1s']])
    for (const source of EARTH_8K_SOURCES) {
      expect(source.url).toMatch(/^https:\/\/eoimages\.gsfc\.nasa\.gov\//)
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
