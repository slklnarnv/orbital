/**
 * Geometry of the ORBITAL mark (an orbit ellipse with a station glint) in a
 * 64-unit box. Mirrors MARK in scripts/build-icons.mjs, which draws the icon
 * set; the loading screen draws the same orbit and moves the glint along it.
 */
export const MARK = { cx: 30, cy: 33, rx: 23, ry: 9.5, tiltDeg: -24, glintDeg: 35 } as const

/** CSS size of the loading-screen mark; the glint path is in these pixels. */
export const BOOT_MARK_PX = 112

/** Point on the tilted orbit at parametric angle `deg`, scaled about the origin. */
export function markPoint(deg: number, scale = 1): [number, number] {
  const tilt = (MARK.tiltDeg * Math.PI) / 180
  const t = (deg * Math.PI) / 180
  const ex = MARK.rx * Math.cos(t)
  const ey = MARK.ry * Math.sin(t)
  return [
    (MARK.cx + ex * Math.cos(tilt) - ey * Math.sin(tilt)) * scale,
    (MARK.cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)) * scale,
  ]
}

const r2 = (n: number): string => String(Math.round(n * 100) / 100)

/**
 * Closed orbit path that starts at the glint and runs toward the bright end
 * of the icon's orbit (sweep 0: decreasing parametric angle). Starting at the
 * glint means a motionless frame (reduced motion) shows the icon itself.
 */
export function orbitPath(scale = 1): string {
  const [x0, y0] = markPoint(MARK.glintDeg, scale)
  const [x1, y1] = markPoint(MARK.glintDeg + 180, scale)
  const arc = `A${r2(MARK.rx * scale)} ${r2(MARK.ry * scale)} ${MARK.tiltDeg} 0 0`
  return `M${r2(x0)} ${r2(y0)}${arc} ${r2(x1)} ${r2(y1)}${arc} ${r2(x0)} ${r2(y0)}Z`
}
