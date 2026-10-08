import type { KeyboardEvent } from 'react'

const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight'])
const PREV_KEYS = new Set(['ArrowUp', 'ArrowLeft'])

/**
 * WAI-ARIA radio group keyboard contract for a `role="radiogroup"` container
 * whose children are `role="radio"` buttons, in the same order as `values`.
 * Arrows move and select (wrapping), Home/End jump to the ends. Pair with
 * `radioTabIndex` so the group is a single Tab stop.
 */
export function handleRadioGroupKeyDown<T>(
  event: KeyboardEvent<HTMLElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void,
): void {
  const index = values.indexOf(current)
  let next: number
  if (NEXT_KEYS.has(event.key)) next = (index + 1) % values.length
  else if (PREV_KEYS.has(event.key)) next = (index - 1 + values.length) % values.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = values.length - 1
  else return

  event.preventDefault()
  select(values[next])
  const radios = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')
  radios[next]?.focus()
}

/** Roving tabindex: only the checked radio (or the first, if none) is tabbable. */
export function radioTabIndex<T>(values: readonly T[], current: T, value: T): 0 | -1 {
  const checked = values.includes(current) ? current : values[0]
  return value === checked ? 0 : -1
}
