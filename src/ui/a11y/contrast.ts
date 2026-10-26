// WCAG 2.x contrast for the HUD tokens (roadmap 017 A4). Pure, so the token
// floor is a unit test rather than a one-off measurement.

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Parses `#rrggbb` or `rgba(r, g, b, a)` / `rgb(r, g, b)`. */
export function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim())
  if (fn) return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) }
  throw new Error(`unsupported colour: ${value}`)
}

/** `fg` composited over an opaque `bg`. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const mix = (f: number, b: number): number => f * fg.a + b * (1 - fg.a)
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 }
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(color: Rgba): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/** Contrast ratio of `fg` (alpha composited) over an opaque `bg`, 1–21. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const a = relativeLuminance(over(fg, bg))
  const b = relativeLuminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
