import React from 'react'

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

/**
 * A highly restrained, premium glass panel container inspired by scientific instrument layouts.
 * Uses a flat, dark slate backdrop, high readability contrasting text, and a minimal 5% white border.
 */
export function GlassPanel({ children, className = '', id }: GlassPanelProps): JSX.Element {
  return (
    <div
      id={id}
      className={`
        bg-slate-950/80
        backdrop-blur-md
        border border-white/5
        rounded-sm
        shadow-xl
        p-4
        ${className}
      `}
    >
      {children}
    </div>
  )
}
