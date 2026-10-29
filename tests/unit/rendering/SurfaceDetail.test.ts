// ─── SurfaceDetail.test.ts — the close-range GIBS inset (roadmap D.8) ───────

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DAY_LAYER,
  DETAIL_EDGE_RADIUS,
  DETAIL_FULL_RADIUS,
  DETAIL_LEVELS,
  DETAIL_TILE_PX,
  DETAIL_WINDOW,
  detailSlot,
  detailTiles,
  detailTileUrl,
  detailWindow,
  NIGHT_LAYER,
  uvToTile,
} from '@/rendering/earth/surfaceDetail'

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
const [L5, L7] = DETAIL_LEVELS

describe('detail levels', () => {
  it('tile the globe exactly', () => {
    for (const level of DETAIL_LEVELS) {
      expect(level.cols * level.tileDeg).toBe(360)
      expect(level.rows * level.tileDeg).toBe(180)
    }
    // GIBS 500m set: level n spans 288°/2^n per 512 px tile.
    expect(L5.tileDeg).toBe(288 / 2 ** 5)
    expect(L7.tileDeg).toBe(288 / 2 ** 7)
  })

  it('builds the night-lights URL with its time dimension', () => {
    expect(detailTileUrl(7, 20, 44, NIGHT_LAYER)).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_Black_Marble/default/2016-01-01/500m/7/20/44.png',
    )
  })

  it('builds GIBS WMTS tile URLs (row before column)', () => {
    expect(detailTileUrl(7, 20, 140)).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_ShadedRelief_Bathymetry/default/500m/7/20/140.jpeg',
    )
  })
})

describe('uvToTile', () => {
  it('maps the sphere UVs onto the GIBS grid', () => {
    expect(uvToTile(0, 1, L5)).toEqual({ x: 0, y: 0 }) // antimeridian, north pole
    expect(uvToTile(0.5, 0.5, L5)).toEqual({ x: 20, y: 10 }) // 0°, 0°
    expect(uvToTile(1.25, 0.5, L5).x).toBeCloseTo(10, 12) // wraps
  })
})

describe('detailWindow and detailTiles', () => {
  it('wraps across the antimeridian', () => {
    const w = detailWindow({ x: 0.3, y: 10 }, L5)
    expect(w.col0).toBe(38)
    const cols = new Set(detailTiles({ x: 0.3, y: 10 }, L5).map((t) => t.col))
    expect([...cols].every((c) => [38, 39, 0, 1].includes(c))).toBe(true)
    expect(cols.has(39) && cols.has(0)).toBe(true)
  })

  it('clamps rows at the poles', () => {
    expect(detailWindow({ x: 10, y: 0.2 }, L5).row0).toBe(0)
    expect(detailWindow({ x: 10, y: 19.9 }, L5).row0).toBe(L5.rows - DETAIL_WINDOW)
  })

  it('gives every window tile its own slot, nearest first', () => {
    for (const center of [{ x: 5.4, y: 7.6 }, { x: 39.9, y: 3.1 }, { x: 77.5, y: 40.5 }]) {
      const level = center.x > 40 ? L7 : L5
      const tiles = detailTiles(center, level)
      expect(new Set(tiles.map((t) => t.slot)).size).toBe(tiles.length)
      expect(tiles.length).toBeLessThanOrEqual(DETAIL_WINDOW * DETAIL_WINDOW)
      for (let i = 1; i < tiles.length; i++) expect(tiles[i].distance).toBeGreaterThanOrEqual(tiles[i - 1].distance)
      for (const t of tiles) expect(t.slot).toBe(detailSlot(t.col, t.row))
    }
  })

  it('keeps the whole inset inside the resident window', () => {
    // Away from the poles, every point within DETAIL_EDGE_RADIUS of the
    // centre lies in a tile the window holds: no window edge is ever drawn.
    for (let i = 0; i < 400; i++) {
      const center = { x: (i * 7.31) % L7.cols, y: 3 + ((i * 3.77) % (L7.rows - 6)) }
      const held = new Set(detailTiles(center, L7).map((t) => `${t.col}/${t.row}`))
      for (let a = 0; a < 16; a++) {
        const angle = (a / 16) * 2 * Math.PI
        const r = DETAIL_EDGE_RADIUS * 0.999
        const col = Math.floor((((center.x + r * Math.cos(angle)) % L7.cols) + L7.cols) % L7.cols)
        const row = Math.floor(center.y + r * Math.sin(angle))
        expect(held.has(`${col}/${row}`)).toBe(true)
      }
    }
  })
})

describe('surface shader contract', () => {
  const glsl = read('src/rendering/shaders/surfaceDetail.glsl')
  const frag = read('src/rendering/shaders/earthSurface.frag')

  it('mirrors the TypeScript constants', () => {
    expect(glsl).toContain(`DETAIL_TILE_PX = ${DETAIL_TILE_PX}.0`)
    expect(glsl).toContain(`DETAIL_WINDOW = ${DETAIL_WINDOW}.0`)
    expect(glsl).toContain(`DETAIL_FULL = ${DETAIL_FULL_RADIUS}`)
    expect(glsl).toContain(`DETAIL_EDGE = ${DETAIL_EDGE_RADIUS}`)
  })

  it('shows the mipmapped day tiles minified at the matching mip, the night tiles only magnified', () => {
    expect(DAY_LAYER.mipmaps).toBe(true)
    expect(NIGHT_LAYER.mipmaps).toBe(false)
    expect(glsl).toContain('smoothstep(fade.x, fade.y, ppt)')
    // Level 5 down to where the 8K base map is as sharp; level 7 down to
    // where level 5 is: ~1.7 mips at most, inside DETAIL_MAX_LOD.
    expect(glsl).toContain('DETAIL_DAY_FADE0 = vec2(0.5, 0.8)')
    expect(glsl).toContain('DETAIL_DAY_FADE1 = vec2(0.3, 0.5)')
    expect(glsl).toContain('DETAIL_NIGHT_FADE = vec2(0.7, 1.3)')
    expect(glsl).toContain('DETAIL_MAX_LOD = 2.0')
    expect(-Math.log2(0.3)).toBeLessThan(2)
    expect(frag).toContain('detailG0, detailPpt0, DETAIL_DAY_FADE0)')
    expect(frag).toContain('detailG1, detailPpt1, DETAIL_DAY_FADE1)')
    // An explicit lod: hardware derivatives jump at slot edges (a line).
    expect(glsl).toContain('mix(base, textureLod(map, st, lod).rgb, w)')
    expect(glsl).toContain('smoothstep(DETAIL_FULL, DETAIL_EDGE, length(d))')
    expect(glsl).toContain('return w * alpha;')
    // Half a texel of the coarser mip in from tile edges: no bleed from the
    // neighbouring slot.
    expect(glsl).toContain('float edge = 0.5 * exp2(ceil(lod)) / DETAIL_TILE_PX;')
    expect(glsl).toContain('clamp(fract(g), vec2(edge), vec2(1.0 - edge))')
  })

  it('takes the detail derivatives before any branch, and only swaps the albedo', () => {
    const main = frag.slice(frag.indexOf('void main()'))
    expect(main.indexOf('detailPixelsPerTexel(detailG1')).toBeGreaterThan(0)
    expect(main.indexOf('detailPixelsPerTexel(detailG1')).toBeLessThan(main.indexOf('if ('))
    expect(main).toContain('vec3 dayColor = albedo * terrainLight * cloudTransmittance * sunWarmth;')
  })

  it('swaps the night lights the same way, smoothly, with points inside NASA texels', () => {
    const main = frag.slice(frag.indexOf('void main()'))
    expect(main).toContain('detailLevelWeight(detailNightWindow1, detailNightCenter1, detailNightSlots1, detailNightOn1, detailG1, detailPpt1, DETAIL_NIGHT_FADE, 0.0, nightSt1)')
    expect(main).toContain('sampleDetailBicubic(detailNightMap1, nightSt1)')
    expect(main).toContain('cityPoints(detailG1 * DETAIL_TILE_PX, lum, detailPpt1 / NIGHT_CELLS)')
    // The swap happens before the photographic curve and the knee, so NASA's
    // lights get the same calibration (and bloom budget) as the base map's.
    expect(main.indexOf('sampleDetailBicubic(detailNightMap1')).toBeLessThan(main.indexOf('vec3 lights = pow(rawNight'))
    // B-spline taps never leave the slot.
    expect(glsl).toContain('clamp(i - 0.5 + w1 / g0, lo, hi)')
    expect(glsl).toContain('clamp(i + 1.5 + w3 / g1, lo, hi)')
  })
})
