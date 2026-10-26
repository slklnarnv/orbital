import { TIME_RATE_PRESETS } from '@/utils/constants'

// ─── Keyboard shortcut registry (roadmap 017 A1) ────────────────────────────
// Every global shortcut is declared here, once: the key handler
// (`useShortcuts`) and the `?` help overlay both read this table, so the
// overlay cannot drift from what the keys actually do. Pure — no DOM, no
// React — so the matching rules are unit-tested in node.
//
// Keys local to one control stay with that control and are listed in
// LOCAL_KEYS (arrows on the revolution tape and in radio groups, Enter in
// the place search): no global shortcut may claim them.

export type ShortcutAction =
  | { kind: 'togglePause' }
  | { kind: 'toggleHud' }
  | { kind: 'locate' }
  | { kind: 'resetView' }
  | { kind: 'rate'; rate: number }
  | { kind: 'live' }
  | { kind: 'toggleOverlay'; overlay: 'passes' | 'settings' | 'help' }
  | { kind: 'close' }

export interface KeyBinding {
  /** `KeyboardEvent.key`, compared case-insensitively. */
  key?: string
  /** `KeyboardEvent.code`: the physical key, for layouts whose `key` differs. */
  codes?: string[]
}

export interface Shortcut {
  id: string
  /** What the help overlay prints in its key column. */
  keys: string[]
  label: string
  group: 'Time' | 'View' | 'Panels'
  bindings: KeyBinding[]
  action: ShortcutAction
  /** Fires while typing in a field (Escape only). */
  whileTyping?: boolean
  /** Skipped on controls that the key natively activates (Space on a button). */
  yieldsToActivation?: boolean
  /** Shift must be up (Shift+Space scrolls up in every browser). */
  noShift?: boolean
  /** Still fires while a modal overlay is open. */
  inModal?: boolean
}

const letter = (char: string): KeyBinding => ({ key: char, codes: [`Key${char.toUpperCase()}`] })
const digit = (n: number): KeyBinding => ({ key: String(n), codes: [`Digit${n}`, `Numpad${n}`] })

const RATE_SHORTCUTS: Shortcut[] = TIME_RATE_PRESETS.map((rate, i) => ({
  id: `rate-${rate}`,
  keys: [String(i + 1)],
  label: `Run at ${rate}×`,
  group: 'Time',
  bindings: [digit(i + 1)],
  action: { kind: 'rate', rate },
}))

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'pause',
    keys: ['Space'],
    label: 'Pause or resume',
    group: 'Time',
    bindings: [{ key: ' ', codes: ['Space'] }],
    action: { kind: 'togglePause' },
    yieldsToActivation: true,
    noShift: true,
  },
  ...RATE_SHORTCUTS,
  {
    id: 'live',
    keys: ['0'],
    label: 'Return to live time',
    group: 'Time',
    bindings: [digit(0)],
    action: { kind: 'live' },
  },
  {
    id: 'locate',
    keys: ['L'],
    label: 'Locate the ISS',
    group: 'View',
    bindings: [letter('l')],
    action: { kind: 'locate' },
  },
  {
    id: 'reset',
    keys: ['R'],
    label: 'Reset to the Earth overview',
    group: 'View',
    bindings: [letter('r')],
    action: { kind: 'resetView' },
  },
  {
    id: 'hud',
    keys: ['H'],
    label: 'Hide or show the HUD',
    group: 'View',
    bindings: [letter('h')],
    action: { kind: 'toggleHud' },
  },
  {
    id: 'passes',
    keys: ['P'],
    label: 'Visible passes',
    group: 'Panels',
    bindings: [letter('p')],
    action: { kind: 'toggleOverlay', overlay: 'passes' },
  },
  {
    id: 'settings',
    keys: ['G'],
    label: 'Render settings',
    group: 'Panels',
    bindings: [letter('g')],
    action: { kind: 'toggleOverlay', overlay: 'settings' },
  },
  {
    id: 'help',
    keys: ['?'],
    label: 'Keyboard shortcuts',
    group: 'Panels',
    // `?` is Shift+/ on US layouts and elsewhere on others: match the
    // character, never the physical key.
    bindings: [{ key: '?' }],
    action: { kind: 'toggleOverlay', overlay: 'help' },
    inModal: true,
  },
  {
    id: 'close',
    keys: ['Esc'],
    label: 'Close the open panel',
    group: 'Panels',
    bindings: [{ key: 'Escape', codes: ['Escape'] }],
    action: { kind: 'close' },
    whileTyping: true,
    inModal: true,
  },
]

/** Keys that individual controls own; listed in the help overlay's footer. */
export const LOCAL_KEYS: ReadonlyArray<{ keys: string[]; label: string; values: string[] }> = [
  { keys: ['←', '→'], label: 'Revolution tape: one minute', values: ['ArrowLeft', 'ArrowRight'] },
  { keys: ['Page up', 'Page down'], label: 'Revolution tape: ten minutes', values: ['PageUp', 'PageDown'] },
  { keys: ['↑', '↓'], label: 'Choices and place search: move', values: ['ArrowUp', 'ArrowDown'] },
  { keys: ['Enter'], label: 'Place search: pick', values: ['Enter'] },
  { keys: ['Tab'], label: 'Move between controls', values: ['Tab'] },
]

/** The parts of a KeyboardEvent the matcher reads. */
export interface KeyInput {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** The parts of the event target the matcher reads. */
export interface TargetInfo {
  tagName: string
  isContentEditable: boolean
  role: string | null
  /** `type` of an <input>. */
  type?: string | null
}

/** Duck-typed so the rules run in node tests with plain objects. */
export function describeTarget(target: unknown): TargetInfo | null {
  if (target === null || typeof target !== 'object' || !('tagName' in target)) return null
  const el = target as {
    tagName: string
    isContentEditable?: boolean
    getAttribute?: (name: string) => string | null
    type?: string
  }
  return {
    tagName: el.tagName.toUpperCase(),
    isContentEditable: el.isContentEditable === true,
    role: el.getAttribute?.('role') ?? null,
    type: typeof el.type === 'string' ? el.type : null,
  }
}

/** Input types that take no typed text: letters and digits are free there. */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file', 'image'])

/** Typing keeps its keys: text fields, selects and contentEditable. */
export function isTypingTarget(target: TargetInfo | null): boolean {
  if (target === null) return false
  if (target.isContentEditable) return true
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  if (target.role === 'combobox' || target.role === 'textbox' || target.role === 'searchbox') return true
  if (target.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((target.type ?? 'text').toLowerCase())
  return false
}

const ACTIVATABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY', 'INPUT', 'SELECT', 'TEXTAREA'])
const ACTIVATABLE_ROLES = new Set(['button', 'link', 'radio', 'switch', 'checkbox', 'option', 'menuitem', 'tab'])

/** Controls that Space presses natively. */
export function isActivatableTarget(target: TargetInfo | null): boolean {
  if (target === null) return false
  return ACTIVATABLE_TAGS.has(target.tagName) || (target.role !== null && ACTIVATABLE_ROLES.has(target.role))
}

/** A typed ASCII character: the layout's own letter, which wins over position. */
const ASCII_CHAR = /^[\x20-\x7e]$/

function matchesBinding(input: KeyInput, binding: KeyBinding): boolean {
  if (binding.key !== undefined && input.key.toLowerCase() === binding.key.toLowerCase()) return true
  // The physical key counts only when the layout typed no ASCII character
  // (Cyrillic, Greek…): on Dvorak, the key at QWERTY's L types "n" and must
  // not locate.
  if (ASCII_CHAR.test(input.key)) return false
  return binding.codes?.includes(input.code) ?? false
}

export interface MatchContext {
  /** A modal overlay (the help overlay) is open. */
  modalOpen: boolean
}

/**
 * The shortcut a keydown triggers, or null. Never fires with Ctrl, Cmd or
 * Alt held (browser and OS shortcuts keep theirs), never while typing
 * (Escape excepted), and Space yields to the control it would press.
 */
export function matchShortcut(
  input: KeyInput,
  target: TargetInfo | null,
  context: MatchContext,
  shortcuts: readonly Shortcut[] = SHORTCUTS,
): Shortcut | null {
  if (input.ctrlKey || input.metaKey || input.altKey) return null
  const typing = isTypingTarget(target)
  for (const shortcut of shortcuts) {
    if (!shortcut.bindings.some((binding) => matchesBinding(input, binding))) continue
    if (typing && !shortcut.whileTyping) return null
    if (shortcut.noShift && input.shiftKey) return null
    if (shortcut.yieldsToActivation && isActivatableTarget(target)) return null
    if (context.modalOpen && !shortcut.inModal) return null
    return shortcut
  }
  return null
}

/**
 * Every pair of shortcuts that claim the same key or physical key, plus any
 * shortcut that claims a key a control owns. Empty for a sound table.
 */
export function findConflicts(
  shortcuts: readonly Shortcut[] = SHORTCUTS,
  localKeys: readonly string[] = LOCAL_KEYS.flatMap((entry) => entry.values),
): string[] {
  const owners = new Map<string, string>()
  const conflicts: string[] = []
  const claim = (value: string, id: string): void => {
    const owner = owners.get(value)
    if (owner !== undefined && owner !== id) conflicts.push(`${value}: ${owner} and ${id}`)
    else owners.set(value, id)
  }
  for (const value of localKeys) owners.set(`key:${value.toLowerCase()}`, 'local').set(`code:${value}`, 'local')
  for (const shortcut of shortcuts) {
    for (const binding of shortcut.bindings) {
      if (binding.key !== undefined) claim(`key:${binding.key.toLowerCase()}`, shortcut.id)
      for (const code of binding.codes ?? []) claim(`code:${code}`, shortcut.id)
    }
  }
  return conflicts
}
