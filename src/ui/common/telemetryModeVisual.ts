import type { TelemetryMode } from '@/types/orbital'

/**
 * Single source of truth for how a telemetry link mode reads in the HUD:
 * its short label, status dot class, and signal color. Every surface that
 * names the mode (top corner, clock caption) uses this so the vocabulary
 * stays identical across the frame.
 */
export function telemetryModeVisual(mode: TelemetryMode): {
  label: string
  dotClass: string
  color: string
} {
  switch (mode) {
    case 'LIVE':
      return { label: 'Live', dotClass: 'hud-dot--live', color: 'var(--signal-live)' }
    case 'HYBRID':
      return { label: 'Cached', dotClass: 'hud-dot--hybrid', color: 'var(--signal-hybrid)' }
    case 'RECOVERY':
      return { label: 'Recovery', dotClass: 'hud-dot--recovery', color: 'var(--signal-recovery)' }
    case 'OFFLINE':
      return { label: 'Fallback', dotClass: 'hud-dot--offline', color: 'var(--signal-offline)' }
  }
}
