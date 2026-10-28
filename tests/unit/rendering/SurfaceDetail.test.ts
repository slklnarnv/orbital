// ─── SurfaceDetail.test.ts — the close-range GIBS inset (roadmap D.8) ───────

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DETAIL_EDGE_RADIUS,
  DETAIL_FULL_RADIUS,
  DETAIL_LEVELS,
  DETAIL_TILE_PX,
  DETAIL_WINDOW,
  detailSlot,
  detailTiles,
  detailTileUrl,
  detailWindow,
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

  it('never minifies the mip-less tiles and fades by radius and per tile', () => {
    expect(glsl).toContain('smoothstep(0.7, 1.3, ppt)')
    expect(glsl).toContain('smoothstep(DETAIL_FULL, DETAIL_EDGE, length(d))')
    expect(glsl).toContain('mix(base, detail, w * alpha)')
    // Half a texel in from tile edges: no bleed from the neighbouring slot.
    expect(glsl).toContain('clamp(fract(g), vec2(0.5 / DETAIL_TILE_PX), vec2(1.0 - 0.5 / DETAIL_TILE_PX))')
  })

  it('takes the detail derivatives before any branch, and only swaps the albedo', () => {
    const main = frag.slice(frag.indexOf('void main()'))
    expect(main.indexOf('detailPixelsPerTexel(detailG1')).toBeGreaterThan(0)
    expect(main.indexOf('detailPixelsPerTexel(detailG1')).toBeLessThan(main.indexOf('if ('))
    expect(main).toContain('vec3 dayColor = albedo * terrainLight * cloudTransmittance * sunWarmth;')
  })
})
