import { useSimulationClock } from '@/hooks/useSimulationClock'
import { formatUtcClockParts } from '@/utils/formatters'

/**
 * MissionClockCluster — the console's center of gravity. UTC mission time at
 * display size, in aviator's Zulu notation, captioned with the tracked
 * object. Link state is declared once, in the top corner — not repeated here.
 */
export function MissionClockCluster(): JSX.Element {
  const simTime = useSimulationClock(1000)
  const { time, date } = formatUtcClockParts(simTime.epochMs)

  return (
    <div
      className="hud-bottom-center hud-text"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        whiteSpace: 'nowrap',
      }}
    >
      <span className="hud-fine" style={{ fontSize: 10.5, letterSpacing: '0.14em' }}>
        {date} UTC
      </span>
      <span
        className="hud-num"
        style={{
          fontSize: 'clamp(30px, 7vw, 44px)',
          fontWeight: 300,
          lineHeight: 1.1,
          letterSpacing: '0.03em',
        }}
      >
        {time}
        <span style={{ opacity: 0.5, marginLeft: 1 }}>Z</span>
      </span>
      <span className="hud-label" style={{ marginTop: 2, color: 'var(--hud-hi)', fontWeight: 500 }}>
        ISS · ZARYA
      </span>
    </div>
  )
}
