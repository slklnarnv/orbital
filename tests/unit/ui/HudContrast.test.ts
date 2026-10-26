import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from '@/ui/a11y/contrast'

// Roadmap 017 A4: the HUD's quietest text tone must meet WCAG AA for small
// text (4.5:1) on the space background. Read from the design system itself
// so a token edit cannot slip under the floor.

const css = readFileSync(new URL('../../../src/index.css', import.meta.url), 'utf8')

function token(name: string): string {
  const match = new RegExp(String.raw`${name}:\s*([^;]+);`).exec(css)
  if (!match) throw new Error(`token ${name} not found`)
  return match[1].trim()
}

describe('HUD text contrast', () => {
  const space = parseColor(token('--space'))

  it.each(['--hud-hi', '--hud-mid', '--hud-lo'])('%s meets 4.5:1 on --space', (name) => {
    expect(contrastRatio(parseColor(token(name)), space)).toBeGreaterThanOrEqual(4.5)
  })

  it('reproduces the audit: the old 38% tone was below AA', () => {
    expect(contrastRatio(parseColor('rgba(241, 237, 228, 0.38)'), space)).toBeLessThan(3.2)
  })

  it('matches the WCAG reference pair (white on black is 21:1)', () => {
    expect(contrastRatio(parseColor('#ffffff'), parseColor('#000000'))).toBeCloseTo(21, 5)
  })
})
