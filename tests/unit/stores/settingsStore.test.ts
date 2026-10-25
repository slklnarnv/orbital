import { describe, expect, it } from 'vitest'
import { sanitizePersistedSettings, useSettingsStore } from '@/stores/settingsStore'

describe('sanitizePersistedSettings', () => {
  it('keeps known keys with valid values', () => {
    expect(sanitizePersistedSettings({
      issModelQuality: 'legacy',
      postprocessing: false,
      orbitLineStyle: 'dashed',
      lensFlare: true,
      groundTrack: true,
    })).toEqual({
      issModelQuality: 'legacy',
      postprocessing: false,
      orbitLineStyle: 'dashed',
      lensFlare: true,
      groundTrack: true,
    })
  })

  it('drops unknown enum values and wrong types so defaults survive', () => {
    expect(sanitizePersistedSettings({
      issModelQuality: 'ultra',
      postprocessing: 'yes',
      orbitLineStyle: 42,
      lensFlare: null,
      groundTrack: 'yes',
    })).toEqual({})
  })

  it('keeps a boolean groundTrack and drops a non-boolean one', () => {
    expect(sanitizePersistedSettings({ groundTrack: false })).toEqual({ groundTrack: false })
    expect(sanitizePersistedSettings({ groundTrack: 'yes' })).toEqual({})
  })

  it('defaults groundTrack to off', () => {
    expect(useSettingsStore.getState().groundTrack).toBe(false)
  })

  it('keeps a boolean shadows setting, drops a non-boolean one, and defaults it on', () => {
    expect(sanitizePersistedSettings({ shadows: false })).toEqual({ shadows: false })
    expect(sanitizePersistedSettings({ shadows: 1 })).toEqual({})
    expect(useSettingsStore.getState().shadows).toBe(true)
  })

  it('ignores unknown keys, including prototype-shaped ones', () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true},"selectionNonce":99,"extra":1}')
    const out = sanitizePersistedSettings(parsed)
    expect(out).toEqual({})
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it.each([null, undefined, 'string', 3, [1, 2]])('returns nothing for non-object input %j', (value) => {
    expect(sanitizePersistedSettings(value)).toEqual({})
  })
})
