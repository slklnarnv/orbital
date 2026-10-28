import type { JSX } from 'react'
/**
 * Line icons for the top-right tool row (Passes, Modules, Settings): 13 px,
 * currentColor, so they take the control's tone like its label does.
 */
export type ToolIconName = 'passes' | 'modules' | 'settings'

export function ToolIcon({ name }: { name: ToolIconName }): JSX.Element {
  return (
    <svg className="hud-tool__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {name === 'passes' && (
        <>
          {/* A pass: an arc over the horizon, the station on it. */}
          <path d="M3.5 18a8.5 8.5 0 0 1 17 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M2 21h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="16.8" cy="11.6" r="2.2" fill="currentColor" />
        </>
      )}
      {name === 'modules' && (
        // A module block: an isometric cube.
        <path
          d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 9l8-4.5M12 12v9M12 12L4 7.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )}
      {name === 'settings' && (
        <>
          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  )
}
