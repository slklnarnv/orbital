import { defineConfig, devices } from '@playwright/test'

// Smoke suite against the PRODUCTION bundle (`vite preview`), not the dev
// server: it proves the shipped build boots. Preview serves dist/ only, so
// specs stub /api/tle and third-party APIs with page.route (see fixtures.ts).
//
// Headless Chromium has no GPU; the swiftshader flags give it software WebGL
// so the R3F canvas initialises. Software rendering is slow, hence the long
// timeouts (Locate loads a 5.3 MiB model).
//
// One worker: the app is heavy under software WebGL, and parallel pages
// starve each other's render loops and make waits flaky.
//
// E2E_DEV=1 runs against the dev server instead. It exposes the DEV-only
// scene hooks (`window.__orbitalControls`, `__orbitalScene`) that the
// viewport spec's station-framing check needs; without them that check skips.
// E2E_PORT moves the server off the default port: locally the server is
// reused when one is already listening, so a second checkout's preview on
// 4173 would otherwise be tested in place of this one.
const dev = process.env.E2E_DEV === '1'
const port = Number(process.env.E2E_PORT) || (dev ? 4174 : 4173)

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Lets `--shard` split by test rather than by file (two files, one of them
  // most of the time), so CI's three shards come out balanced. Every test
  // boots its own page, so none depends on another's order.
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: dev
      ? `npx vite --port ${port} --strictPort`
      : `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
