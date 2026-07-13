import { get, set, del } from 'idb-keyval'
import type { TLEData } from '@/types/orbital'
import { TLE_MAX_AGE_MS } from '@/utils/constants'
import { validateTLEData } from '@/core/orbital/TLEParser'

// ─── TLE Cache ────────────────────────────────────────────────────────────────
/**
 * Persists TLE data to IndexedDB so the app works across sessions without
 * re-fetching. Falls back gracefully if IndexedDB is unavailable.
 */
const CACHE_KEY_PREFIX = 'tle_'

export class TLECache {
  private _memCache = new Map<number, TLEData>()  // noradId → TLEData

  private key(noradId: number): string {
    return `${CACHE_KEY_PREFIX}${noradId}`
  }

  async get(noradId: number): Promise<TLEData | null> {
    // Check memory cache first
    if (this._memCache.has(noradId)) {
      const cached = this._memCache.get(noradId)!
      if (validateTLEData(cached, noradId).ok && Date.now() - cached.fetchedAt <= TLE_MAX_AGE_MS) {
        return cached
      }
      await this.remove(noradId)
      return null
    }

    try {
      const stored = await get<TLEData>(this.key(noradId))
      if (!stored) return null

      // Treat IndexedDB as untrusted input: validate before it can reach an entity.
      if (!validateTLEData(stored, noradId).ok || Date.now() - stored.fetchedAt > TLE_MAX_AGE_MS) {
        await this.remove(noradId)
        return null
      }

      this._memCache.set(noradId, stored)
      return stored
    } catch {
      return null  // IndexedDB unavailable — degrade silently
    }
  }

  async set(noradId: number, tle: TLEData): Promise<void> {
    if (!validateTLEData(tle, noradId).ok) {
      throw new Error('Refusing to cache an invalid TLE')
    }
    this._memCache.set(noradId, tle)
    try {
      await set(this.key(noradId), tle)
    } catch {
      // IndexedDB unavailable — memory cache still works for this session
    }
  }

  async remove(noradId: number): Promise<void> {
    this._memCache.delete(noradId)
    try {
      await del(this.key(noradId))
    } catch { /* silent */ }
  }
}

export const tleCache = new TLECache()
