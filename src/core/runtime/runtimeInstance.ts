import { simulationClock } from '@/core/clock/SimulationClock'
import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { SimulationRuntime } from './SimulationRuntime'

/** Single application runtime owner for the browser session. */
export const simulationRuntime = new SimulationRuntime(simulationClock, telemetryManager)
