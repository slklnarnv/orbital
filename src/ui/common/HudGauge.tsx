interface HudGaugeProps {
  label: string
  value: string
  unit: string
  /** Cluster width in px — keeps the pair on a shared column rhythm */
  width?: number
}

/**
 * Gauge readout: bare label, numeral, unit. No bezel, no ornament — a value
 * this stable at this cadence has nothing honest to plot beneath it, so the
 * numerals stand alone with the rest of the console's typography.
 */
export function HudGauge({ label, value, unit, width = 96 }: HudGaugeProps): JSX.Element {
  return (
    <div
      className="hud-gauge hud-text"
      style={{ width }}
      role="group"
      aria-label={`${label}: ${value} ${unit}`}
    >
      <span className="hud-label">{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span className="hud-num hud-gauge__value" style={{ fontSize: 30, fontWeight: 300, lineHeight: 1.05 }}>
          {value}
        </span>
        <span className="hud-gauge__unit">{unit}</span>
      </div>
    </div>
  )
}
