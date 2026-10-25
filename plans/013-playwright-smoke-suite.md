# Plan 013: A Playwright smoke suite proves the built app boots, locates the station, and keeps its controls working

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat aa206a1..HEAD -- package.json .github/workflows/verify.yml eslint.config.js .gitignore src/ui/clusters/TimeControls.tsx src/ui/common/SettingsGear.tsx src/ui/clusters/CameraCluster.tsx src/ui/layout/TopBar.tsx src/hooks/useHudVisibility.ts src/stores/settingsStore.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" facts against the live code; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2 (roadmap A.3 — postponed twice "because Playwright was not installed")
- **Effort**: M
- **Risk**: LOW for app code (no app source changes); MED for CI flakiness (software WebGL)
- **Depends on**: plan 003 (DONE — Node 22, pinned actions in `verify.yml`)
- **Category**: tests
- **Planned at**: commit `aa206a1`, 2026-10-25

## Why this matters

All 350 unit tests run in Node without a DOM or WebGL. Nothing automated
proves that the production bundle boots, that WebGL initialises, that Locate
reaches the station, or that the keyboard shortcuts and persisted settings
work — every one of those has regressed before and was caught only by hand.
A small Chromium smoke suite against `vite preview` closes that gap.

## Current state (facts the tests rely on)

- Playwright: a browser build for Playwright **1.63.0** is pre-installed in
  this environment (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`,
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). It is NOT in `package.json`.
  Pin `@playwright/test` to exactly `1.63.0` so the local browser matches.
- `vite preview` serves `dist/` only. It does NOT serve `/api/tle` (the dev
  middleware in `vite.config.ts` is `apply: 'serve'`) and the DEV-only hooks
  (`window.__orbitalScene`, `__orbitalControls`, `?failAssets`) are absent.
  Tests must therefore stub network with `page.route` and assert on the DOM.
- Network the app makes at boot: `GET /api/tle` (JSON
  `{ line1, line2, fetchedAt, source: 'celestrak' }`); fallback
  `https://api.wheretheiss.at/...`; geo: `https://api.bigdatacloud.net/...`
  and `https://api.open-meteo.com/...` (after ~3 s, every 5 s).
- Packaged TLE: `src/data/fallback-tle.json` has `line1`, `line2`, `epoch`.
- DOM hooks:
  - Telemetry mode label (top-left, `src/ui/layout/TopBar.tsx`): a
    `span.hud-label` whose text is one of `Live`, `Cached`, `Recovery`,
    `Fallback` (from `telemetryModeVisual`).
  - Locate button: stable id `#btn-locate-iss`; camera status text in an
    element with `role="status"` (`CameraCluster.tsx`), e.g.
    `Orbital  ·  Free` → `Follow  ·  Locked` (non-breaking/double spaces —
    match with a regex like `/Follow\s*·\s*Locked/`).
  - Pause: `button[aria-label="Pause time"]` ↔ `button[aria-label="Resume time"]`
    (`TimeControls.tsx`); Space toggles it unless focus is in an input or on
    a button.
  - Hide HUD: pressing `h` toggles class `hud-hidden` on `<html>`
    (`src/hooks/useHudVisibility.ts`).
  - Settings: gear `button[aria-label="Render settings"]` opens
    `div[role="dialog"][aria-label="Render settings"]`, containing
    `[role="radiogroup"][aria-label="Orbit line style"]` with `role="radio"`
    buttons (`aria-checked`). Persisted via zustand `persist` under
    localStorage key `orbital-settings` (JSON with a `state` object).
- Known quirk (docs/HANDOFF.md): Playwright locator `.click()` can time out on
  this app because the rAF render loop defeats actionability waits — click
  by coordinates (`page.mouse.click(x, y)` from `boundingBox()`), or use
  `{ force: true }`. Keyboard presses are fine.
- Software WebGL in headless Chromium: launch with
  `args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']`.
  Locate (loading the 5.3 MiB Locate model) took ~20–40 s in a reviewer run.
- Unit tests: vitest includes `tests/**/*.test.ts` only, so `*.spec.ts` files
  under `tests/e2e/` are NOT picked up by vitest. `tsconfig.test.json`
  includes `tests`, so the spec IS type-checked by `npm run typecheck`, and
  `eslint .` lints it.
- `eslint.config.js` ignores `['dist', 'node_modules', 'public', '.tmp-iss-build', '.zcode']`.
  Agent worktrees under `.claude/worktrees/` (local only) currently break
  `eslint .` with tsconfig-root errors; add `.claude` to the ignores.
- `.github/workflows/verify.yml` (after plan 003): one `verify` job on
  `ubuntu-latest`, actions pinned to SHAs with a `# v4.4.0` comment
  (`actions/checkout@11d5960a326750d5838078e36cf38b85af677262`,
  `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`),
  `node-version-file: .nvmrc`, `persist-credentials: false`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` (REAL install in the worktree — this plan adds a dependency) | exit 0 |
| Add dep | `npm install --save-dev --save-exact @playwright/test@1.63.0` | exit 0 |
| E2E | `npm run test:e2e` | all specs pass |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `package.json`, `package-lock.json` (one devDependency + one script)
- `playwright.config.ts` (create)
- `tests/e2e/smoke.spec.ts` (create)
- `tests/e2e/fixtures.ts` (create — route stubs)
- `.github/workflows/verify.yml` (add an `e2e` job)
- `eslint.config.js` (ignores only), `.gitignore` (Playwright output dirs)

**Out of scope**: ANY file under `src/` (if a test cannot be written without
an app change, STOP and report), `vite.config.ts`, unit tests, `docs/**`,
`plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch; commit per step; never commit red.
- Subject style: `Add a Playwright smoke suite against the production preview`.
- End every commit body with the `Co-Authored-By:` line YOUR harness
  specifies (naming the model that did the work), then
  `Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u`.
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: Dependency, script, ignores

- `npm ci`, then `npm install --save-dev --save-exact @playwright/test@1.63.0`.
- `package.json` scripts: add `"test:e2e": "playwright test"`. Do NOT add it
  to `verify` (verify stays fast and GPU-free).
- `eslint.config.js` ignores: add `'.claude'`, `'test-results'`, `'playwright-report'`.
- `.gitignore`: add `test-results/` and `playwright-report/` (with a comment).

**Verify**: `npx playwright --version` → `Version 1.63.0`; `npm run lint` → exit 0.

### Step 2: Config

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
```
(Comment the file: why preview, why swiftshader, why one worker.)

**Verify**: `npx playwright test --list` → lists 0 tests without error (no specs yet) or exits 0.

### Step 3: Network fixtures

`tests/e2e/fixtures.ts` exports `async function stubNetwork(page, opts?: { tle?: 'ok' | 'fail' })`:
- `**/api/tle` → `ok`: JSON `{ line1, line2, fetchedAt: Date.now(), source: 'celestrak' }`
  built from `src/data/fallback-tle.json` (import it with
  `import fallback from '../../src/data/fallback-tle.json' with { type: 'json' }`
  or read it with `fs` — whichever the type-check accepts); `fail`: status 503.
- `https://api.wheretheiss.at/**` → status 503 (forces the cache/packaged path when `tle: 'fail'`).
- `https://api.bigdatacloud.net/**` → JSON `{ countryName: 'Australia', continent: 'Oceania', locality: '' }`.
- `https://api.open-meteo.com/**` → JSON
  `{ timezone: 'Australia/Brisbane', timezone_abbreviation: 'AEST', utc_offset_seconds: 36000, current: { temperature_2m: 24.5, weather_code: 1 } }`.
Also export `collectErrors(page): string[]` that pushes `console` messages of
type `error` and `pageerror` messages into an array it returns.

**Verify**: `npm run typecheck` → exit 0.

### Step 4: The specs

`tests/e2e/smoke.spec.ts` — every test calls `stubNetwork(page)` (or with
`tle: 'fail'`) BEFORE `page.goto('/')`:
1. **boots clean**: `collectErrors`; goto; expect `canvas` visible; expect a
   `.hud-label` with exact text `Live` within 30 s; wait 5 s more; expect the
   collected errors to equal `[]`.
2. **Locate reaches Follow · Locked**: goto; wait for `Live`; click
   `#btn-locate-iss` by coordinates (from `boundingBox()`); expect
   `[role="status"]` to match `/Follow\s*·\s*Locked/` within 150 s.
3. **Space toggles pause**: goto; wait for `Live`; `page.keyboard.press('Space')`
   with focus on `body` (call `page.locator('body').focus()` or click an empty
   canvas area by coordinates first — NOT a button); expect
   `button[aria-label="Resume time"]` visible; press Space again; expect
   `button[aria-label="Pause time"]` visible.
4. **H hides the HUD**: press `h`; expect `html` to have class `hud-hidden`;
   press `h` again; expect it not to.
5. **settings survive reload**: open the gear (coordinate click); in the
   "Orbit line style" radiogroup click the radio whose `aria-checked` is
   `false` (coordinate click), remember its text; `page.reload()`; read
   `localStorage.getItem('orbital-settings')` and assert the parsed
   `state.orbitLineStyle` changed from its initial value (read it before the
   click too); reopen the gear and assert the remembered radio has
   `aria-checked="true"`.
6. **TLE failure degrades gracefully**: `stubNetwork(page, { tle: 'fail' })`;
   `collectErrors`; goto; expect the mode label to show one of
   `Cached|Recovery|Fallback` (regex on the `.hud-label` set) within 45 s and
   never `Live`; expect no `pageerror` entries (console `error`s from the
   503s are allowed — filter to entries starting with `pageerror`).

**Verify**: `npm run test:e2e` → 6 passed. If a test is flaky, fix the
wait (polling `expect`), never add arbitrary long sleeps beyond 5 s and
never `test.skip`.

### Step 5: CI job

In `.github/workflows/verify.yml`, add a second job:
```yaml
  e2e:
    needs: verify
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env:
          CI: 'true'
```

**Verify**: `node -e "const y=require('fs').readFileSync('.github/workflows/verify.yml','utf8');if(!/e2e:/.test(y)||!/needs: verify/.test(y)||/@v\d/.test(y))process.exit(1)"` → exit 0
(if the sandbox refuses inline `node -e`, put the same check in a script file).

### Step 6: Gate

**Verify**: `npm run verify` → exit 0 AND `npm run test:e2e` → 6 passed.

## Test plan

Six smoke specs as above. They complement, not replace, the unit suite and
the manual checklist in `docs/verification.md`.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `npm run test:e2e` → 6 passed (paste the summary line in the report)
- [ ] `grep -n '"@playwright/test": "1.63.0"' package.json` matches
- [ ] `git diff --stat aa206a1..HEAD` lists only in-scope files (ignore `plans/`)

## STOP conditions

- Any spec cannot pass without changing `src/**`.
- The pinned `@playwright/test@1.63.0` cannot find the pre-installed browser
  (error mentions a missing executable) — report the exact message.
- Locate does not reach `Follow · Locked` within 150 s in two consecutive runs.

## Maintenance notes

- If Playwright is bumped, the CI `playwright install` follows automatically;
  locally the pre-installed browser must match the pinned version.
- Specs assert on user-visible DOM only; when HUD copy changes, update the
  selectors here in the same commit.
- A `page.clock`-driven variant (deterministic time) was deliberately left out:
  the 10 Hz runtime uses recursive `setTimeout`, which needs a spike first.
