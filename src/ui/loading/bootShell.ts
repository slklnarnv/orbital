/**
 * index.html paints a static copy of the loading screen inside #root so the
 * first frame shows it before the bundle runs. React replaces that copy on
 * mount; carrying the shell's animation clock over keeps the orbiting glint
 * from jumping back to its start at the handover.
 */
let shellStartTime: CSSNumberish | null = null

/** Call before React renders into #root (the shell is gone afterwards). */
export function captureBootShellClock(): void {
  const glint = document.querySelector('#root .boot-glint')
  if (!glint || typeof glint.getAnimations !== 'function') return
  shellStartTime = glint.getAnimations()[0]?.startTime ?? null
}

/** Puts every animation under `element` on the shell's clock. */
export function alignToBootShellClock(element: Element | null): void {
  if (!element || shellStartTime === null || typeof element.getAnimations !== 'function') return
  for (const animation of element.getAnimations({ subtree: true })) {
    animation.startTime = shellStartTime
  }
}
