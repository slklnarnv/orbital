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

### 2026-10-26 — `baseline-2026-10-26.json` (4K Earth, PR #44)

AMD Ryzen 7 8840HS, Radeon 780M (integrated, ANGLE D3D11), 28 GiB, Edge 156;
1280×720 at DPR 1.5 (1920×1080 buffer), 8 s per row, no contention in any
window (other processes ≤ 1.5% CPU, no other GPU user).

| Scenario | fps | p90 / p99 ms | > 20 ms | GPU ms mean / p99 | draws | tracked GPU MiB |
|---|---|---|---|---|---|---|
| overview, Bloom | 59.9 | 16.8 / 17.7 | 0 | 9.2 / 11.2 | 28 | 526 |
| overview, no Bloom | 59.9 | 16.8 / 17.2 | 0 | 12.5 / 18.1 | 13 | 338 |
| Follow, Bloom | 59.9 | 16.8 / 16.9 | 0 | 11.4 / 14.1 | 198 | 640 |
| Follow, no Bloom | 59.9 | 17.1 / 17.6 | 0 | 16.2 / 18.4 | 183 | 452 |
| Follow scrub, Bloom | 59.3 | 16.8 / 17.0 | 1 (100 ms) | 11.1 / 13.9 | 198 | 640 |
| Follow scrub, no Bloom | 59.9 | 16.8 / 16.9 | 0 | 15.9 / 19.0 | 183 | 452 |
| Inspect, Bloom | 59.9 | 16.8 / 16.9 | 0 | 15.3 / 19.1 | 238 | 1,081 |
| Inspect, no Bloom | 59.9 | 16.8 / 17.1 | 0 | 16.1 / 18.6 | 223 | 893 |
| Inspect scrub, Bloom | 59.9 | 16.8 / 17.0 | 0 | 16.0 / 20.0 | 239 | 1,081 |
| Inspect scrub, no Bloom | 59.9 | 16.8 / 17.2 | 0 | 16.2 / 21.0 | 224 | 893 |

Read with care:

- Every row holds 60 fps; the 2026-10-26 Inspect-scrub reading of 44.5 fps
  was the busy GPU, not the app.
- GPU headroom is thin at close range: Inspect and both scrubs average
  15–16 GPU ms against a 16.7 ms frame, with p99 at 19–21 ms. Any new
  per-pixel cost there will drop frames on this GPU.
- With Bloom, the scene pass is the cost (overview 3.8 ms, Follow 6.6,
  Inspect 9.7 of 15.3); the composite, MSAA resolve and bloom chain add
  ~3.5 ms together. During a scrub the station shadow (`fb18 2048x2048`)
  redraws in ~28% of frames at 0.5–1.1 ms each.
- **Bloom off measures more GPU time than Bloom on** (overview 12.5 vs 9.2
  ms, Follow 16.2 vs 11.4) although it draws less. With Bloom off
  everything renders straight to the canvas, whose single segment also
  carries the default framebuffer's work (its MSAA resolve and the hand-off
  to the browser compositor). Unexplained beyond that; worth a look before
  any Bloom-off optimisation.
- Texture memory: six 4K maps (day, night, starmap as sRGB; specular and
  the cloud maps as RGBA8) at 42.7 MiB each with mips, 256 MiB, are most
  of the 330 MiB at overview. The specular mask is single-channel data
  stored as RGBA8 (a C.2 target). Inspect adds the full model: textures 593
  MiB, buffers 280 MiB.
