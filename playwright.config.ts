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
