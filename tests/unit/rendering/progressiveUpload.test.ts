import { describe, expect, it } from 'vitest'
import { nextStrip } from '@/rendering/earth/progressiveUpload'

// 8192×4096 BC7: 2048 blocks × 16 bytes = 32 KiB per block row, 1024 rows.
const ROW = 2048 * 16
const LEVEL0 = ROW * 1024

describe('progressive compressed upload strips', () => {
  it('cuts a level on block boundaries within the byte budget', () => {
    const rows = (1024 * 1024) / ROW // 1 MiB per frame = 32 block rows
    const first = nextStrip(0, 4096, LEVEL0, 0, rows)
    expect(first).toEqual({ level: 0, y: 0, height: 128, byteOffset: 0, byteLength: 1024 * 1024 })
    const second = nextStrip(0, 4096, LEVEL0, 32, rows)
    expect(second).toMatchObject({ y: 128, height: 128, byteOffset: 1024 * 1024 })
  })

  it('covers the whole level exactly, the last strip ending on the edge', () => {
    let row = 0
    let bytes = 0
    let last = nextStrip(0, 4096, LEVEL0, 0, 100)
    while (row * 4 < 4096) {
      last = nextStrip(0, 4096, LEVEL0, row, 100)
      expect(last.byteOffset).toBe(bytes)
      bytes += last.byteLength
      row += last.byteLength / ROW
    }
    expect(bytes).toBe(LEVEL0)
    expect(last.y + last.height).toBe(4096)
  })

  it('always advances, and handles levels smaller than one block', () => {
    expect(nextStrip(0, 4096, LEVEL0, 0, 0.3).byteLength).toBe(ROW)
    // 2×1 level: one block, 16 bytes; the strip is the level's real height.
    expect(nextStrip(12, 1, 16, 0, 10)).toEqual({ level: 12, y: 0, height: 1, byteOffset: 0, byteLength: 16 })
  })

  it('rejects data that does not split into block rows', () => {
    expect(() => nextStrip(0, 8, 33, 0, 1)).toThrow(/block rows/)
  })
})
