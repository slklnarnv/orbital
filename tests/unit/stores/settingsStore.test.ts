import { describe, expect, it } from 'vitest'
import { sanitizePersistedSettings } from '@/stores/settingsStore'

describe('sanitizePersistedSettings', () => {
  it('keeps known keys with valid values', () => {
    expect(sanitizePersistedSettings({
      issModelQuality: 'legacy',
      postprocessing: false,
      orbitLineStyle: 'dashed',
      lensFlare: true,
    })).toEqual({
      issModelQuality: 'legacy',
      postprocessing: false,
      orbitLineStyle: 'dashed',
      lensFlare: true,
    })
  })

  it('drops unknown enum values and wrong types so defaults survive', () => {
    expect(sanitizePersistedSettings({
      issModelQuality: 'ultra',
      postprocessing: 'yes',
      orbitLineStyle: 42,
      lensFlare: null,
    })).toEqual({})
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
