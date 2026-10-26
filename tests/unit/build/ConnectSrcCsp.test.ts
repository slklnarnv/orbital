// ─── ConnectSrcCsp.test.ts — every fetched host is allowed by connect-src ────
//
// Regression for the live "Passing over" fallback (2026-10-25): BigDataCloud's
// documented host began answering 307 → api-bdc.io, CSP checks every redirect
// hop, and connect-src listed only the first host, so every reverse geocode
// was blocked. (Place names are now offline; BigDataCloud is gone.) This test
// reads the production CSP from vercel.json and checks it against the
// absolute URLs in src/ plus the redirect targets those hosts are known to
// send.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../..')

/**
 * Absolute URLs in src/ that are not network requests: identifiers, and the
 * About panel's credit links (navigations, which connect-src does not
 * govern). Exact URLs, so a fetch to one of these hosts still fails here.
 */
const NOT_FETCHED = new Set([
  'http://www.w3.org/2000/svg',
  'https://github.com/slklnarnv/orbital',
  'https://celestrak.org/',
  'https://wheretheiss.at/',
  'https://www.naturalearthdata.com/',
  'https://open-meteo.com/',
])

/**
 * Hosts a fetched host redirects to. None today (checked with curl,
 * 2026-10-25). Add an entry when a provider moves behind a redirect; the
 * browser follows it and CSP must allow the target too.
 */
const REDIRECT_TARGETS: Record<string, string[]> = {}

function productionConnectSrc(): string[] {
  const config = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  }
  const csp = config.headers
    .find((rule) => rule.source === '/(.*)')
    ?.headers.find((header) => header.key === 'Content-Security-Policy')?.value
  expect(csp).toBeDefined()
  const directive = csp!
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === 'connect-src')
  expect(directive).toBeDefined()
  return directive!.slice(1)
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

/** Hosts of every absolute URL string literal in src/. */
function fetchedHosts(): string[] {
  const hosts = new Set<string>()
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8')
    for (const [, url] of text.matchAll(/['"`](https?:\/\/[^'"`\s$]+)/g)) {
      if (NOT_FETCHED.has(url)) continue
      hosts.add(new URL(url).host)
    }
  }
  return [...hosts].sort()
}

/** Hosts the code reaches, directly or through a known redirect. */
function reachedHosts(): string[] {
  return [...new Set(fetchedHosts().flatMap((host) => [host, ...(REDIRECT_TARGETS[host] ?? [])]))].sort()
}

describe('production connect-src', () => {
  it('finds the external endpoints in src/', () => {
    expect(fetchedHosts()).toEqual(['api.open-meteo.com', 'api.wheretheiss.at'])
  })

  it('allows every host the client fetches, including redirect targets', () => {
    const allowed = productionConnectSrc()
    for (const host of reachedHosts()) expect(allowed).toContain(`https://${host}`)
  })

  it('allows no external host the client does not reach', () => {
    const external = productionConnectSrc().filter((source) => source.startsWith('https://'))
    expect(external.sort()).toEqual(reachedHosts().map((host) => `https://${host}`))
  })
})
