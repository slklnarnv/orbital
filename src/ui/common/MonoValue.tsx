interface MonoValueProps {
  label: string;
  value: string | number;
  unit?: string;
  highlight?: boolean;
  className?: string;
}

/**
 * MonoValue displays scientific numeric telemetry values using a clean spacing rhythm.
 * Wraps values inside strict IBM Plex Mono rendering with optional high-contrast color shifts.
 */
export function MonoValue({
  label,
  value,
  unit,
  highlight = false,
  className = ''
}: MonoValueProps): JSX.Element {
  return (
    <div className={`flex justify-between items-baseline py-0.5 text-xs ${className}`}>
      <span className="text-[var(--color-text-secondary)] font-sans select-none">
        {label}
      </span>
      <div className="flex items-baseline gap-1 font-mono">
        <span
          className={`
            font-semibold
            ${highlight ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}
          `}
        >
          {value}
        </span>
        {unit && (
          <span className="text-[10px] text-[var(--color-text-secondary)] opacity-60">
            {unit}
          </span>
        )}
      </div>
    </div>
  )
}
