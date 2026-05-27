import { useEffect, useState } from 'react'
import { simulationClock } from '@/core/clock/SimulationClock'
import type { SimulationTime } from '@/types/orbital'

/**
 * React hook to subscribe to the centralized SimulationClock.
 * Throttles state updates to prevent high-frequency React re-renders.
 *
 * @param throttleMs Throttling interval in milliseconds (default: 1000ms for 1Hz UI updates)
 */
export function useSimulationClock(throttleMs: number = 1000): SimulationTime {
  const [time, setTime] = useState<SimulationTime>(() => simulationClock.now())

  useEffect(() => {
    let lastUpdate = 0

    const unsubscribe = simulationClock.onTick((simTime) => {
      const now = Date.now()
      if (now - lastUpdate >= throttleMs) {
        setTime(simTime)
        lastUpdate = now
      }
    })

    return unsubscribe
  }, [throttleMs])

  return time
}
