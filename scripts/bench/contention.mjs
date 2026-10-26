// Contention guard for `npm run bench` (Windows only): is anything else
// using the GPU or the CPU while we measure?
//
// GPU: a game holding the GPU (an `aces.exe` at ~90% 3D utilisation) once
// made a whole evening of fps readings meaningless. Windows exposes
// per-process GPU engine utilisation as performance counters (instance names
// look like `pid_1234_luid_0x…_phys_0_eng_0_engtype_3d`).
//
// CPU: other agents' headless browsers on SwiftShader render on the CPU and
// never show on the GPU counters; two of them took ~85% of 16 cores and
// stalled the app's main thread for 200 ms frames. Per-process CPU comes
// from Get-Process deltas.
//
// The bench's own processes (this node, vite preview, and the bench Edge,
// recognised by its profile directory) are excluded from both.
import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** A foreign process at or above this 3D/compute utilisation (%) contends. */
export const GPU_BUSY_PCT = 10
/** Foreign processes together at or above this share of all cores (%) contend. */
export const CPU_BUSY_PCT = 15
/** Engines that compete with rendering. Video decode and copy engines are listed, not counted. */
const CONTENDING_ENGINE = /3d|compute/i
/** The desktop compositor always draws (and spikes while a game is fullscreen); listed, never counted. */
const NEVER_BUSY = new Set(['dwm.exe', 'idle', 'system idle process'])
const isGpuBusy = (row) => !row.own && !NEVER_BUSY.has(row.name.toLowerCase()) && row.pct >= GPU_BUSY_PCT

const POWERSHELL = 'powershell.exe'
const COUNTER = '\\GPU Engine(*)\\Utilization Percentage'
const GPU_ROWS = `$_.CounterSamples | Where-Object { $_.CookedValue -gt 0.05 } | ForEach-Object { [pscustomobject]@{ i = $_.InstanceName; v = [math]::Round($_.CookedValue, 2) } }`
// Instances come and go between samples (a process exits), which Get-Counter
// reports as an invalid sample: skip those rather than fail the run.
const gpuScript = (samples) => `Get-Counter '${COUNTER}' -SampleInterval 1 ${samples > 0 ? `-MaxSamples ${samples}` : '-Continuous'} -ErrorAction SilentlyContinue | ForEach-Object { [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @(${GPU_ROWS}))); [Console]::Out.Flush() }`
// One line per second: each process's CPU over that second, as % of all cores.
const cpuScript = (samples) => `$n = [Environment]::ProcessorCount; $prev = @{}; $t0 = Get-Date; $k = 0
while (${samples > 0 ? `$k -le ${samples}` : '$true'}) {
  $rows = foreach ($p in Get-Process) { $c = $p.CPU; if ($c -ne $null) { if ($k -gt 0 -and $prev.ContainsKey($p.Id)) { $v = ($c - $prev[$p.Id]) / $dt * 100 / $n; if ($v -ge 0.5) { [pscustomobject]@{ pid = $p.Id; pct = [math]::Round($v, 1) } } }; $prev[$p.Id] = $c } }
  if ($k -gt 0) { [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @($rows))); [Console]::Out.Flush() }
  $k++; Start-Sleep -Milliseconds 1000; $t = Get-Date; $dt = ($t - $t0).TotalSeconds; $t0 = $t
}`
// Command lines are matched in PowerShell, not shipped as JSON: some carry
// control characters that ConvertTo-Json leaves unescaped.
const processScript = (marker) => `$m = '${(marker ?? '').replace(/'/g, "''")}'
Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, @{ n = 'Marked'; e = { $m -ne '' -and $_.CommandLine -and $_.CommandLine.Contains($m) } } | ConvertTo-Json -Compress`

const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-Command', script]
const round1 = (v) => Math.round(v * 10) / 10

/**
 * Per-process GPU utilisation from one counter sample: for each pid, the
 * busiest contending engine (3D / compute) and the busiest engine of any
 * kind. Pure, for tests.
 */
export function summariseCounterRows(rows) {
  const byPid = new Map()
  for (const { i, v } of rows) {
    const match = /^pid_(\d+)_.*_engtype_(.+)$/i.exec(i)
    if (!match) continue
    const pid = Number(match[1])
    const engine = match[2]
    const engines = byPid.get(pid) ?? new Map()
    // Several physical engines can share a type; utilisation of a type is its busiest one.
    engines.set(engine, Math.max(engines.get(engine) ?? 0, v))
    byPid.set(pid, engines)
  }
  const out = []
  for (const [pid, engines] of byPid) {
    let engine = ''
    let pct = 0
    let anyEngine = ''
    let anyPct = 0
    for (const [name, value] of engines) {
      if (CONTENDING_ENGINE.test(name) && value > pct) { pct = value; engine = name }
      if (value > anyPct) { anyPct = value; anyEngine = name }
    }
    out.push({ pid, engine: engine || anyEngine, pct: round1(pct), anyPct: round1(anyPct) })
  }
  return out.sort((a, b) => b.pct - a.pct || b.anyPct - a.anyPct)
}

/** Every pid descended from `rootPids` (inclusive) in a Win32_Process list. Pure. */
export function descendantPids(processes, rootPids) {
  const children = new Map()
  for (const p of processes) {
    if (!children.has(p.ParentProcessId)) children.set(p.ParentProcessId, [])
    children.get(p.ParentProcessId).push(p.ProcessId)
  }
  const out = new Set()
  const stack = [...rootPids]
  while (stack.length > 0) {
    const pid = stack.pop()
    if (out.has(pid)) continue
    out.add(pid)
    for (const child of children.get(pid) ?? []) stack.push(child)
  }
  return out
}

/**
 * Mean per-process CPU (% of all cores) over a series of samples, and the
 * foreign total. Pure, for tests.
 */
export function summariseCpu(samples, ownPids, names = new Map()) {
  const sums = new Map()
  for (const sample of samples) {
    for (const { pid, pct } of sample) sums.set(pid, (sums.get(pid) ?? 0) + pct)
  }
  const rows = [...sums].map(([pid, sum]) => ({
    pid,
    name: names.get(pid) ?? '?',
    pct: round1(sum / Math.max(1, samples.length)),
    own: ownPids.has(pid),
  }))
  const foreign = rows.filter((r) => !r.own && !NEVER_BUSY.has(r.name.toLowerCase()) && r.pid !== 0)
  const foreignPct = round1(foreign.reduce((acc, r) => acc + r.pct, 0))
  return {
    foreignPct,
    busy: foreignPct >= CPU_BUSY_PCT,
    top: foreign.sort((a, b) => b.pct - a.pct).slice(0, 5),
    ownPct: round1(rows.filter((r) => r.own).reduce((acc, r) => acc + r.pct, 0)),
  }
}

async function processList(marker) {
  const { stdout } = await run(POWERSHELL, psArgs(processScript(marker)), { maxBuffer: 32 * 1024 * 1024, windowsHide: true })
  return JSON.parse(stdout.trim() || '[]')
}

/** `own`: `{ pids, marker }`; the marker is matched against command lines. */
function ownership(processes, own = {}) {
  const roots = [...(own.pids ?? [])]
  for (const p of processes) if (p.Marked) roots.push(p.ProcessId)
  return {
    names: new Map(processes.map((p) => [p.ProcessId, p.Name])),
    ownPids: descendantPids(processes, roots),
  }
}

function judge(gpuSamples, cpuSamples, processes, own) {
  const { names, ownPids } = ownership(processes, own)
  const peak = new Map()
  for (const sample of gpuSamples) {
    for (const row of sample) {
      const prev = peak.get(row.pid)
      if (!prev || row.pct > prev.pct) peak.set(row.pid, row)
    }
  }
  const gpuRows = [...peak.values()]
    .map((row) => ({ ...row, name: names.get(row.pid) ?? '?', own: ownPids.has(row.pid) }))
    .sort((a, b) => b.pct - a.pct)
  const cpu = summariseCpu(cpuSamples, ownPids, names)
  const gpuBusy = gpuRows.filter(isGpuBusy)
  return {
    samples: { gpu: gpuSamples.length, cpu: cpuSamples.length },
    contended: gpuBusy.length > 0 || cpu.busy,
    gpuBusy,
    gpuAll: gpuRows.filter((r) => !r.own),
    ownGpuPeakPct: Math.max(0, ...gpuRows.filter((r) => r.own).map((r) => r.pct)),
    cpu,
  }
}

/** A one-line reason for a contended verdict. */
export function describeContention(verdict) {
  const parts = verdict.gpuBusy.map((b) => `${b.name} (pid ${b.pid}) ${b.pct}% GPU ${b.engine}`)
  if (verdict.cpu.busy) {
    const top = verdict.cpu.top.map((t) => `${t.name} ${t.pid} ${t.pct}%`).join(', ')
    parts.push(`other processes at ${verdict.cpu.foreignPct}% of all CPU cores (${top})`)
  }
  return parts.join('; ')
}

function stream(script, onSample) {
  const child = spawn(POWERSHELL, psArgs(script), { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      onSample(JSON.parse(line))
    } catch {
      // A partial line on shutdown; ignore.
    }
  })
  return child
}

/**
 * One blocking check (~3 s): GPU and CPU users outside the bench's own
 * processes, over two 1 s samples.
 */
export async function sampleContention(own = {}) {
  if (process.platform !== 'win32') return { supported: false, contended: false }
  const gpu = []
  const cpu = []
  const children = [
    stream(gpuScript(2), (rows) => gpu.push(summariseCounterRows(rows))),
    stream(cpuScript(2), (rows) => cpu.push(rows)),
  ]
  await Promise.all(children.map((child) => new Promise((resolve) => child.on('exit', resolve))))
  return { supported: true, ...judge(gpu, cpu, await processList(own.marker), own) }
}

/**
 * Background sampler: long-lived PowerShell streams (a sample per second
 * each), so every scenario is judged on its own measurement window.
 */
export function startContentionMonitor() {
  if (process.platform !== 'win32') {
    return { window: async () => ({ supported: false, contended: false }), stop: async () => {} }
  }
  const gpu = []
  const cpu = []
  const children = [
    stream(gpuScript(0), (rows) => gpu.push({ at: Date.now(), rows: summariseCounterRows(rows) })),
    stream(cpuScript(0), (rows) => cpu.push({ at: Date.now(), rows })),
  ]
  const between = (series, from, to) => series.filter((s) => s.at >= from && s.at <= to + 1500).map((s) => s.rows)
  return {
    async window(from, to, own) {
      return { supported: true, ...judge(between(gpu, from, to), between(cpu, from, to), await processList(own?.marker), own) }
    },
    async stop() {
      for (const child of children) child.kill()
    },
  }
}
