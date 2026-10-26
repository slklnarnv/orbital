# Performance bench (`npm run bench`)

Roadmap A.2: a committed, repeatable performance run on a real GPU. The
harness lives in `scripts/bench/`; committed baselines are the JSON files next
to this README.

## What it does

1. Builds the app with `vite build --mode bench` into `.bench/dist`
   (production React and minification, plus the `window.__orbital*` hooks
   from `src/utils/debugHooks.ts`; the production bundle has none) and serves
   it with `vite preview`, which sends the production headers (CSP).
2. Checks that nothing else is using the machine (`scripts/bench/contention.mjs`):
   - **GPU**: the Windows GPU engine counters
     (`\GPU Engine(*)\Utilization Percentage`); any other process at 10% or
     more on a 3D or compute engine (a game) contends;
   - **CPU**: per-process CPU from `Get-Process` deltas; other processes
     together at 15% or more of all cores contend. This catches other
     agents' headless browsers on SwiftShader, which render on the CPU and
     never show on the GPU counters (two of them, at ~85% of 16 cores,
     produced 200 ms frames in an otherwise idle-GPU run).

   A contended machine **refuses the run** (exit 2) and names the processes.
   `--allow-busy-gpu` runs anyway, but every scenario measured while
   something else was busy is flagged `contention.contended` in the JSON, a
   loud banner is printed and the exit code is 3. Both samplers keep
   streaming during the run (one sample a second each), so a game or a
   second browser starting mid-run is caught too. The bench's own processes
   (node, `vite preview`, and its Edge, recognised by its profile directory)
   are excluded; `dwm.exe` is listed but never counted.
3. Launches installed Microsoft Edge headless with ANGLE on D3D11
   (`--use-angle=d3d11 --enable-gpu`): the machine's real GPU, not
   SwiftShader. Default viewport 1280×720 at DPR 1.5 (a 1920×1080 drawing
   buffer). Network calls are stubbed like the e2e suite.
4. Seeks the simulation to a time where the station stays sunlit for at
   least 25 minutes and runs it at 1× (`--at <epoch ms>` pins a time for
   before/after comparisons; the log prints the epoch to reuse; `--live`
   skips the seek).
5. Measures each scenario with Bloom on and off (`--duration 8` s after a
   `--settle 3` s wait):

   | Scenario | How it gets there |
   |---|---|
   | `overview` | the boot view of the whole Earth |
   | `follow` | clicks Locate; waits for Follow and a committed detail model (the Locate LOD) |
   | `follow-scrub` | drags the orbit tape 25% ↔ 75% (4 s period) in Follow |
   | `inspect` | wheel-zooms into Inspect (≤ 130 km), waits for the full model to be ready, then 5 s more |
   | `inspect-scrub` | the same tape drag in Inspect |

## What it reports

Per scenario, in `.bench/results/bench-<time>.json` (or `--out`):

- `frames`: fps over the recorded span, p50/p90/p99/max frame time and
  frames over 20 ms, from `requestAnimationFrame` timestamps.
- `gpu`: GPU ms per frame (mean, p50/p90/p99) and **per pass**, from
  `EXT_disjoint_timer_query_webgl2`. Timer queries cannot nest, so
  `scripts/bench/page-probe.js` cuts each frame into segments at every
  draw-framebuffer bind and around every `blitFramebuffer`, labelled by
  target (`canvas`, `fbN` in creation order) and viewport size. A pass that
  runs only on some frames (the cached station shadow) reports its mean
  when it runs, its per-frame average and how often it ran. Frames the
  driver marks disjoint are dropped and counted.
- `memory`: GPU memory tracked from every texture, renderbuffer and buffer
  allocation (sized formats; compressed uploads by byte length) plus the
  canvas drawing buffer, and the largest textures. This is what the app
  asks the driver to hold, not a driver readout.
- `state`: camera mode and distance, detail model, pixel ratio (the DPR
  governor can lower it under load), sunlit, simulation time, three's
  `renderer.info` counts.
- Machine: GPU renderer string, CPU, RAM, Edge version, commit.

Reading the pass labels: `fbN` numbers framebuffers in creation order, so a
label is stable within one run but can shift when the code changes; the
viewport size says what the pass is. At the default 1920×1080 buffer,
`1920x1080` targets are the scene and full-resolution composites, `blit` is
the MSAA resolve, 960×540 down to the smallest sizes are UnrealBloom's mip
chain, `2048x2048` is the station's self-shadow map (redrawn on demand, so
its `ranInPct` is low), and `canvas` is what reaches the screen.

## Running it

```bash
npm run bench
```

Options: `--scenarios overview,follow,follow-scrub,inspect,inspect-scrub`,
`--bloom on,off`, `--duration 8`, `--settle 3`, `--width 1280 --height 720
--dpr 1.5`, `--at <ISO|ms>`, `--live`, `--no-build`, `--headed`,
`--label text`, `--out file.json`, `--allow-busy-gpu`, `--port 4180`.

Windows only for the contention guard (elsewhere it warns that nothing was
checked). Needs Microsoft Edge installed. Close games and other WebGL pages
first; other agents' headless browsers and builds count too.

## Baselines

**Pending.** The harness landed on 2026-10-26 while up to eight other agent
sessions were running headless browsers on the same machine; the guard
refused every attempt (other processes at 70–85% of all CPU cores, and a
game at ~90% GPU earlier in the day). Record the baseline on an idle
machine with:

```bash
npm run bench -- --label "A.2 baseline" --out docs/bench/baseline-<date>.json
```

then summarise it here (fps, p99, frames over 20 ms and GPU ms per scenario,
the top passes, tracked GPU memory) and in `plans/PROGRESS.md`.
