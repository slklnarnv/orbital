# Plan 003: Patched dev toolchain, a full-tree CI audit, pinned actions on Node 22, and a scheduled fallback-TLE refresh

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e78d38d..HEAD -- package.json package-lock.json .github/ .nvmrc README.md CLAUDE.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 002 refreshes the data once; this plan automates it)
- **Category**: security / dx
- **Planned at**: commit `e78d38d`, 2026-10-24

## Why this matters

1. `npm audit` (full tree) reports 7 HIGH advisories in the build/dev
   toolchain that CI never sees, because CI runs `npm audit --omit=dev`.
   The worst is vite 6.4.2 (`<=6.4.3`: dev-server cross-origin script
   execution through custom middleware — this repo adds exactly such a
   middleware, `devApiTle` in `vite.config.ts` — plus `server.fs` bypasses and
   Windows launch-editor issues; `run.bat` shows Windows dev is real). postcss,
   nanoid, source-map-js, browserslist, zod and sharp also have fixes within
   their current majors. These affect developer machines and the build that
   produces the shipped bundle, not the runtime app.
2. CI runs Node 20, which reached end-of-life in April 2026, and uses mutable
   action tags (`@v4`) with default `persist-credentials: true` while
   `npm ci` runs dependency install scripts.
3. The packaged fallback TLE decays past its 7-day usefulness unless someone
   remembers `npm run refresh:tle`; a scheduled workflow should open the PR.

## Current state

- `.github/workflows/verify.yml` (whole file):
  ```yaml
  name: verify
  on:
    push:
      branches: [main]
    pull_request:
  permissions:
    contents: read
  jobs:
    verify:
      runs-on: ubuntu-latest
      timeout-minutes: 15
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: npm
        - run: npm ci
        - run: npm run verify
        - run: npm audit --omit=dev --audit-level=high
  ```
- `package.json`: `"engines": { "node": ">=20" }`, `"@types/node": "20.19.43"`,
  `"vite": "^6.0.0"` (lockfile resolves 6.4.2), `"vitest": "^4.1.10"`,
  `"sharp": "^0.35.4"`.
- Current full-tree audit (`npm audit`): high — vite `<=6.4.3`, postcss
  `<=8.5.22`, nanoid `<=3.3.17`, source-map-js `1.0.0-1.2.1`, browserslist
  `<=4.28.6`, zod `<4.6.6`, sharp `<0.35.5`; moderate — vitest/@vitest/mocker
  `<=4.1.11`, fflate `0.6.x` (inside three-stdlib, transitive of drei),
  baseline-browser-mapping; low — @babel/core. Registry today: vite 6.4.5,
  postcss 8.5.31, vitest 4.1.12, sharp 0.35.5.
- `src/core/telemetry/NetworkMonitor.ts:11-12` guards `navigator` for Node 20
  (Node 21+ has a global `navigator`; the guard stays correct either way — do
  not remove it).
- `README.md` says "Requires Node.js 20 or later." (Development section) and
  `CLAUDE.md` line 15 says "Requires Node 20+." and line 13 mentions the Node
  20 `navigator` trap.
- `scripts/refresh-fallback-tle.mjs` exists; `npm run refresh:tle` runs it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` (this plan changes deps — use a REAL install in the worktree, not a symlink) | exit 0 |
| Audit (full) | `npm audit --audit-level=high` | exit 0 after Step 1 |
| Audit (prod) | `npm audit --omit=dev --audit-level=high` | exit 0 |
| Resolve a tag SHA | `git ls-remote https://github.com/actions/checkout 'refs/tags/v4*'` | lists tag SHAs |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `package.json`, `package-lock.json`
- `.github/workflows/verify.yml`
- `.github/workflows/refresh-tle.yml` (create)
- `.nvmrc` (create)
- `README.md` — ONLY the "Requires Node.js 20 or later." sentence
- `CLAUDE.md` — ONLY the two Node-version mentions (lines 13–15)

**Out of scope** (do NOT touch):
- Major-version upgrades: React 19, @react-three/fiber 9, drei 10, three
  r18x, Vite 7/8, satellite.js 6/7, vitest 5, @vitejs/plugin-react 5+. Each
  is a coupled migration with a large blast radius and gets its own plan.
- `fflate` (moderate, transitive through drei/three-stdlib, unreachable at
  runtime) — leave it; it goes away with the drei upgrade.
- Any `src/**` change. The `navigator` guard in `NetworkMonitor.ts` stays.
- `docs/**`, `plans/PROGRESS.md` (the reviewer's docs pass records this).

## Git workflow

- Work on your worktree's branch. Commit per logical unit (deps; CI; refresh
  workflow). Subject style matches `git log` (imperative, sentence case, no
  prefix), e.g. `Patch the dev toolchain within its current majors`.
- End every commit body with these two lines verbatim:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u
  ```
- Stage by explicit path, never `git add -A`. Do NOT push.

## Steps

### Step 1: Patch the toolchain within current majors

Run `npm ci`, then:
```bash
npm install --save-dev vite@^6.4.5 vitest@^4.1.12 sharp@^0.35.5
npm update postcss nanoid source-map-js browserslist zod baseline-browser-mapping @babel/core
```
Keep the existing caret style in `package.json` (`"vite": "^6.4.5"` etc.).
Do not change any other version range.

**Verify**: `npm audit --audit-level=high` → exit 0 (no high/critical left;
the moderate fflate advisory may remain). `npm ls vite` shows 6.4.5 or later
6.x.

### Step 2: Node 22 everywhere

- Create `.nvmrc` containing exactly `22` and a trailing newline.
- `package.json`: `"engines": { "node": ">=22" }`; `@types/node` →
  `22.x` latest (`npm install --save-dev --save-exact @types/node@22`).
- `README.md`: "Requires Node.js 20 or later." → "Requires Node.js 22 or later."
- `CLAUDE.md` lines 13–15: keep the warning about guarding module-scope
  browser reads, but phrase it for the current floor, e.g.
  `surprises (guard module-scope browser reads such as navigator; Node 20
  lacked a global navigator and this broke CI once). Requires Node 22+.`

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Harden `verify.yml`

Resolve the latest v4 release SHAs for `actions/checkout` and
`actions/setup-node` with `git ls-remote` (pick the highest `v4.x.y` tag;
if the tag is annotated, use the `^{}` peeled commit SHA). Then write:
```yaml
      - uses: actions/checkout@<40-char-sha> # v4.x.y
        with:
          persist-credentials: false
      - uses: actions/setup-node@<40-char-sha> # v4.x.y
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run verify
      - run: npm audit --omit=dev --audit-level=high
      - run: npm audit --audit-level=high
```
Keep `permissions: contents: read`, triggers and timeout unchanged.

**Verify**: `node -e "const y=require('fs').readFileSync('.github/workflows/verify.yml','utf8');if(/@v\d/.test(y)||!/persist-credentials: false/.test(y)||!/node-version-file: .nvmrc/.test(y))process.exit(1)"` → exit 0.

### Step 4: Scheduled fallback-TLE refresh workflow

Create `.github/workflows/refresh-tle.yml`:
- `on: schedule: - cron: '17 6 * * 1,4'` (Mon + Thu 06:17 UTC) and
  `workflow_dispatch:`.
- `permissions: contents: write, pull-requests: write`.
- One job on `ubuntu-latest`, `timeout-minutes: 15`, steps: the same pinned
  checkout (here `persist-credentials: true` is REQUIRED so the push works —
  add a comment saying so) and pinned setup-node (`node-version-file: .nvmrc`,
  `cache: npm`); `npm ci`; `npm run refresh:tle`; then a shell step:
  ```bash
  if git diff --quiet -- src/data/fallback-tle.json; then
    echo "Fallback TLE unchanged"; exit 0
  fi
  npm run verify
  epoch=$(node -p "require('./src/data/fallback-tle.json').epoch.slice(0,10)")
  branch="chore/refresh-fallback-tle-$epoch"
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git switch -c "$branch"
  git add src/data/fallback-tle.json
  git commit -m "Refresh packaged fallback TLE (epoch $epoch)"
  git push --force-with-lease origin "$branch"
  gh pr create --base main --head "$branch" \
    --title "Refresh packaged fallback TLE (epoch $epoch)" \
    --body "Automated twice-weekly refresh via npm run refresh:tle; npm run verify passed." \
    || echo "PR already exists or PR creation is disabled for Actions"
  ```
  with `env: GH_TOKEN: ${{ github.token }}` on that step.
- Add a header comment: the repo setting "Allow GitHub Actions to create and
  approve pull requests" must be on for `gh pr create` to succeed.

**Verify**: `node -e "const y=require('fs').readFileSync('.github/workflows/refresh-tle.yml','utf8');for(const s of ['workflow_dispatch','refresh:tle','npm run verify','gh pr create','node-version-file: .nvmrc'])if(!y.includes(s)){console.error('missing',s);process.exit(1)}if(/@v\d/.test(y))process.exit(1)"` → exit 0.

### Step 5: Gate

**Verify**: `npm run verify` → exit 0; `npm audit --omit=dev --audit-level=high` → exit 0.

## Test plan

No new unit tests (tooling only). The gate (`npm run verify`: asset budget,
shader ramps, typecheck, lint, 246 unit tests, build) is the regression check
for the dependency bumps.

## Done criteria

- [ ] `npm audit --audit-level=high` exits 0
- [ ] `npm run verify` exits 0
- [ ] `grep -n "@v[0-9]" .github/workflows/*.yml` returns nothing
- [ ] `.nvmrc` contains `22`; `package.json` engines is `>=22`
- [ ] `git diff --stat e78d38d..HEAD` lists only the in-scope files

## STOP conditions

- Step 1 requires bumping any package across a major version to clear a
  HIGH advisory — report which, do not bump.
- `npm run verify` fails after Step 1 and the failure is not an obvious
  one-line type fix inside `package.json`/lockfile scope.
- `git ls-remote` cannot reach github.com.

## Maintenance notes

- Consider Dependabot (`github-actions` + `npm` ecosystems) to keep the
  pinned SHAs and patch versions moving; not added here to keep scope tight.
- The scheduled refresh only opens a PR; merging it is a human decision.
- The deferred majors (React 19 + R3F 9 + drei 10 together, then three, then
  Vite 7/8, satellite.js 7) are recorded in `plans/README.md`.
