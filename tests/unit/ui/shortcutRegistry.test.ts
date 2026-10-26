import { describe, expect, it } from 'vitest'
import {
  SHORTCUTS,
  describeTarget,
  findConflicts,
  isTypingTarget,
  matchShortcut,
  type KeyInput,
  type Shortcut,
  type TargetInfo,
} from '@/ui/shortcuts/shortcutRegistry'

// Roadmap 017 A1: one registry for every global key. These pin the rules
// the handler relies on — never while typing, never with Ctrl/Cmd/Alt, Space
// yields to the control it would press — and that no two shortcuts (or a
// shortcut and a control's own keys) share a key.

const press = (key: string, code: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
})

const element = (tagName: string, extra: Partial<TargetInfo> = {}): TargetInfo => ({
  tagName,
  isContentEditable: false,
  role: null,
  type: null,
  ...extra,
})

const BODY = element('BODY')
const idle = { modalOpen: false }

function id(input: KeyInput, target: TargetInfo | null = BODY, context = idle): string | null {
  return matchShortcut(input, target, context)?.id ?? null
}

describe('shortcut table', () => {
  it('binds every key the roadmap lists', () => {
    expect(id(press(' ', 'Space'))).toBe('pause')
    expect(id(press('h', 'KeyH'))).toBe('hud')
    expect(id(press('l', 'KeyL'))).toBe('locate')
    expect(id(press('r', 'KeyR'))).toBe('reset')
    expect(id(press('1', 'Digit1'))).toBe('rate-1')
    expect(id(press('2', 'Digit2'))).toBe('rate-10')
    expect(id(press('3', 'Digit3'))).toBe('rate-60')
    expect(id(press('4', 'Digit4'))).toBe('rate-300')
    expect(id(press('0', 'Digit0'))).toBe('live')
    expect(id(press('p', 'KeyP'))).toBe('passes')
    expect(id(press('g', 'KeyG'))).toBe('settings')
    expect(id(press('?', 'Slash', { shiftKey: true }))).toBe('help')
    expect(id(press('Escape', 'Escape'))).toBe('close')
  })

  it('maps 1–4 to the transport presets in order', () => {
    const rates = ['1', '2', '3', '4'].map((key) => {
      const action = matchShortcut(press(key, `Digit${key}`), BODY, idle)?.action
      return action?.kind === 'rate' ? action.rate : null
    })
    expect(rates).toEqual([1, 10, 60, 300])
  })

  it('has no conflicts between shortcuts or with the keys controls own', () => {
    expect(findConflicts()).toEqual([])
  })

  it('detects a conflict when two shortcuts claim one key', () => {
    const clash: Shortcut = { ...SHORTCUTS.find((s) => s.id === 'locate')!, id: 'clash' }
    expect(findConflicts([...SHORTCUTS, clash])).toEqual(['key:l: locate and clash', 'code:KeyL: locate and clash'])
  })

  it('detects a shortcut claiming a control-owned key', () => {
    const arrow: Shortcut = { ...SHORTCUTS[0], id: 'arrow', bindings: [{ key: 'ArrowLeft' }] }
    expect(findConflicts([arrow])).toEqual(['key:arrowleft: local and arrow'])
  })

  it('gives every shortcut a key cap and a sentence-case label', () => {
    const ids = new Set<string>()
    for (const shortcut of SHORTCUTS) {
      expect(ids.has(shortcut.id)).toBe(false)
      ids.add(shortcut.id)
      expect(shortcut.keys.length).toBeGreaterThan(0)
      // Sentence case: capital first letter, no ALL CAPS words but acronyms.
      expect(shortcut.label).toMatch(/^[A-Z]/)
      const shouted = shortcut.label.split(/\s+/).filter((word) => /^[A-Z]{2,}$/.test(word))
      expect(shouted.every((word) => ['ISS', 'HUD'].includes(word))).toBe(true)
    }
  })
})

describe('typing never fires a shortcut', () => {
  const fields: Array<[string, TargetInfo]> = [
    ['text input', element('INPUT', { type: 'text' })],
    ['input with no type', element('INPUT')],
    ['datetime-local (Set time)', element('INPUT', { type: 'datetime-local' })],
    ['search combobox (Passes)', element('INPUT', { type: 'text', role: 'combobox' })],
    ['textarea', element('TEXTAREA')],
    ['select', element('SELECT')],
    ['contentEditable', element('DIV', { isContentEditable: true })],
  ]

  it.each(fields)('letters, digits and Space stay with a %s', (_name, target) => {
    for (const [key, code] of [['l', 'KeyL'], ['h', 'KeyH'], ['1', 'Digit1'], ['0', 'Digit0'], [' ', 'Space'], ['?', 'Slash']]) {
      expect(id(press(key, code), target)).toBeNull()
    }
  })

  it.each(fields)('Escape still closes the panel from a %s', (_name, target) => {
    expect(id(press('Escape', 'Escape'), target)).toBe('close')
  })

  it('treats checkbox-like inputs as controls, not text fields', () => {
    expect(isTypingTarget(element('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(id(press('l', 'KeyL'), element('INPUT', { type: 'checkbox' }))).toBe('locate')
  })
})

describe('modifiers and activation', () => {
  it('leaves Ctrl, Cmd and Alt combinations to the browser', () => {
    expect(id(press('r', 'KeyR', { ctrlKey: true }))).toBeNull()
    expect(id(press('l', 'KeyL', { metaKey: true }))).toBeNull()
    expect(id(press('1', 'Digit1', { altKey: true }))).toBeNull()
  })

  it('leaves Shift+Space to page scrolling', () => {
    expect(id(press(' ', 'Space', { shiftKey: true }))).toBeNull()
  })

  it('lets Space press the focused button, radio or link instead of pausing', () => {
    expect(id(press(' ', 'Space'), element('BUTTON'))).toBeNull()
    expect(id(press(' ', 'Space'), element('A'))).toBeNull()
    expect(id(press(' ', 'Space'), element('DIV', { role: 'radio' }))).toBeNull()
    expect(id(press(' ', 'Space'), element('DIV', { role: 'slider' }))).toBe('pause')
  })

  it('lets letter shortcuts fire while a button has focus', () => {
    expect(id(press('l', 'KeyL'), element('BUTTON'))).toBe('locate')
  })

  it('pauses everything but help and Escape while the help overlay is open', () => {
    const modal = { modalOpen: true }
    expect(id(press('l', 'KeyL'), BODY, modal)).toBeNull()
    expect(id(press(' ', 'Space'), BODY, modal)).toBeNull()
    expect(id(press('?', 'Slash', { shiftKey: true }), BODY, modal)).toBe('help')
    expect(id(press('Escape', 'Escape'), BODY, modal)).toBe('close')
  })
})

describe('keyboard layouts', () => {
  it('matches the typed letter, not the QWERTY position (Dvorak)', () => {
    // Dvorak: the key at QWERTY's L types "n"; the key at QWERTY's P types "l".
    expect(id(press('n', 'KeyL'))).toBeNull()
    expect(id(press('l', 'KeyP'))).toBe('locate')
  })

  it('falls back to the physical key on non-Latin layouts', () => {
    expect(id(press('д', 'KeyL'))).toBe('locate')
    expect(id(press('р', 'KeyH'))).toBe('hud')
  })

  it('takes Shift+digit on layouts where digits need Shift (AZERTY)', () => {
    expect(id(press('1', 'Digit1', { shiftKey: true }))).toBe('rate-1')
    expect(id(press('&', 'Digit1'))).toBeNull()
  })

  it('accepts upper-case letters (Caps Lock)', () => {
    expect(id(press('L', 'KeyL', { shiftKey: true }))).toBe('locate')
  })
})

describe('describeTarget', () => {
  it('reads tag, role, type and contentEditable from an element-like object', () => {
    const fake = {
      tagName: 'input',
      type: 'text',
      isContentEditable: false,
      getAttribute: (name: string) => (name === 'role' ? 'combobox' : null),
    }
    expect(describeTarget(fake)).toEqual({ tagName: 'INPUT', isContentEditable: false, role: 'combobox', type: 'text' })
  })

  it('returns null for window-like targets', () => {
    expect(describeTarget(null)).toBeNull()
    expect(describeTarget({})).toBeNull()
  })
})
