// ─── bootMarkSync.test.ts — one mark, four copies ────────────────────────────
//
// The mark's geometry lives in src/ui/loading/bootMark.ts. Three other files
// carry literal copies that cannot import it: the static first-paint shell in
// index.html, the glint's CSS offset-path in src/index.css, and the icon
// generator scripts/build-icons.mjs. A drift would make the glint leave the
// drawn orbit, or the loading screen stop matching the icon.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { BOOT_MARK_PX, MARK, orbitPath } from '@/ui/loading/bootMark'

const ROOT = path.resolve(__dirname, '../../..')
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8')

describe('boot mark copies', () => {
  it('index.html draws the orbit from orbitPath()', () => {
    const html = read('index.html')
    const drawn = [...html.matchAll(/class="boot-(?:orbit|trail)" d="([^"]+)"/g)].map((m) => m[1])
    expect(drawn).toEqual([orbitPath(), orbitPath()])
  })

  it('the glint offset-path is orbitPath() at the mark size', () => {
    const css = read('src/index.css')
    expect(css).toContain(`offset-path: path('${orbitPath(BOOT_MARK_PX / 64)}');`)
    expect(css).toMatch(new RegExp(String.raw`\.boot-mark \{[^}]*width: ${BOOT_MARK_PX}px;`))
  })

  it('the icon generator uses the same geometry', () => {
    const script = read('scripts/build-icons.mjs')
    const literal = /const MARK = (\{[^}]+\})/.exec(script)?.[1]
    expect(literal).toBeDefined()
    const parsed = new Function(`return ${literal}`)() as typeof MARK
    expect(parsed).toEqual({ ...MARK })
  })

  it('the orbit path starts at the glint, so a still frame shows the icon', () => {
    expect(orbitPath()).toMatch(/^M49\.43 30\.31A23 9\.5 -24 0 0 /)
  })
})
