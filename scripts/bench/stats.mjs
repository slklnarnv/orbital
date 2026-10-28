// Pure summaries for `npm run bench` (unit-tested in tests/unit/build/benchStats.test.ts).

/** Nearest-rank percentile of an ascending-sorted array (p in 0..100). */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

const round = (value, digits = 2) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits)

/**
 * Frame-time summary from rAF timestamps (ms). fps is frames over the
 * recorded span, so a long hitch lowers it as much as it should.
 */
export function summariseFrames(stamps, { slowMs = 20 } = {}) {
  const deltas = []
  for (let i = 1; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1])
  const sorted = [...deltas].sort((a, b) => a - b)
  const span = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0
  return {
    frames: deltas.length,
    fps: span > 0 ? round((deltas.length * 1000) / span, 1) : null,
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.length ? sorted[sorted.length - 1] : null),
    over20ms: deltas.filter((d) => d > slowMs).length,
    over20msPct: deltas.length ? round((100 * deltas.filter((d) => d > slowMs).length) / deltas.length, 1) : null,
  }
}

/**
 * GPU time per frame and per pass from the probe's resolved frames. A pass
 * that runs only on some frames (the cached station shadow) reports its mean
 * over the frames it ran in and how often it ran.
 */
export function summariseGpu(gpuFrames) {
  if (gpuFrames.length === 0) return null
  const totals = gpuFrames.map((f) => f.total).sort((a, b) => a - b)
  const draws = gpuFrames.map((f) => f.draws).sort((a, b) => a - b)
  const passes = new Map()
  for (const frame of gpuFrames) {
    for (const [name, ms] of Object.entries(frame.passes)) {
      const entry = passes.get(name) ?? { name, sum: 0, frames: 0, values: [] }
      entry.sum += ms
      entry.frames += 1
      entry.values.push(ms)
      passes.set(name, entry)
    }
  }
  return {
    frames: gpuFrames.length,
    meanMs: round(totals.reduce((a, b) => a + b, 0) / totals.length),
    p50Ms: round(percentile(totals, 50)),
    p90Ms: round(percentile(totals, 90)),
    p99Ms: round(percentile(totals, 99)),
    drawsP50: percentile(draws, 50),
    passes: [...passes.values()]
      .map((p) => ({
        name: p.name,
        meanMs: round(p.sum / p.frames, 3),
        p90Ms: round(percentile(p.values.sort((a, b) => a - b), 90), 3),
        perFrameMs: round(p.sum / gpuFrames.length, 3),
        ranInPct: round((100 * p.frames) / gpuFrames.length, 1),
      }))
      .filter((p) => p.perFrameMs >= 0.005)
      .sort((a, b) => b.perFrameMs - a.perFrameMs),
  }
}

/** MiB with one decimal. */
export const mib = (bytes) => round(bytes / (1024 * 1024), 1)
