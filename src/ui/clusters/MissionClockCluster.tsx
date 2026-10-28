import { useSimulationClock } from '@/hooks/useSimulationClock'
import { formatUtcClockParts } from '@/utils/formatters'
import { TimeControls } from '@/ui/clusters/TimeControls'

/**
 * MissionClockCluster — the console's center of gravity. UTC mission time at
 * display size, in aviator's Zulu notation, captioned with the tracked
 * object, with the time transport beneath it. Link state is declared once,
 * in the top corner — not repeated here.
 */
export function MissionClockCluster(): JSX.Element {
  const simTime = useSimulationClock(1000)
  const { time, date } = formatUtcClockParts(simTime.epochMs)

  return (
    <div className="hud-bottom-center hud-text">
      <span className="hud-fine hud-clock__date">{date} UTC</span>
      <span className="hud-num hud-clock__time">
        {time}
        <span style={{ opacity: 0.5, marginLeft: 1 }}>Z</span>
      </span>
      <span className="hud-label hud-clock__caption">ISS · Zarya</span>
      <TimeControls />
    </div>
  )
}
