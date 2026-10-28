import type { JSX } from 'react'
import {
  useSettingsStore,
  type IssModelQuality,
  type OrbitLineStyle,
} from '@/stores/settingsStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { RENDER_SCALES, type RenderScale } from '@/rendering/scene/renderScale'
import { handleRadioGroupKeyDown, radioTabIndex } from './radioGroup'
import { useOverlay } from '../overlay/useOverlay'
import { ToolIcon } from './ToolIcon'

const MODEL_OPTIONS: Array<{ value: IssModelQuality; label: string; hint: string }> = [
  { value: 'high', label: 'High fidelity', hint: 'IGOAL · animated' },
  { value: 'legacy', label: 'Legacy', hint: 'Performance · static' },
]

const ORBIT_LINE_OPTIONS: Array<{ value: OrbitLineStyle; label: string }> = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'dashed', label: 'Dashed' },
]

const RENDER_SCALE_OPTIONS: Array<{ value: RenderScale; label: string }> = RENDER_SCALES.map((value) => ({
  value,
  label: value === 'auto' ? 'Auto' : `${value * 100}%`,
}))

const MODEL_VALUES = MODEL_OPTIONS.map((option) => option.value)
const ORBIT_LINE_VALUES = ORBIT_LINE_OPTIONS.map((option) => option.value)
const RENDER_SCALE_VALUES = RENDER_SCALE_OPTIONS.map((option) => option.value)

/**
 * SettingsGear — render-settings access, last in the top-right tool row:
 * a gear and a "Settings" label that open a small popover
 * with the ISS model selection, the orbit line, a Visuals section and the
 * render scale.
 */
export function SettingsGear(): JSX.Element {
  // Shared overlay system: one panel open at a time, Escape and `G` close
  // it, focus returns to the gear (see ui/overlay/overlay.ts).
  const { isOpen, triggerRef, panelRef, onTriggerClick } = useOverlay('settings')
  const issModelQuality = useSettingsStore((state) => state.issModelQuality)
  const setIssModelQuality = useSettingsStore((state) => state.setIssModelQuality)
  const postprocessing = useSettingsStore((state) => state.postprocessing)
  const setPostprocessing = useSettingsStore((state) => state.setPostprocessing)
  const orbitLineStyle = useSettingsStore((state) => state.orbitLineStyle)
  const setOrbitLineStyle = useSettingsStore((state) => state.setOrbitLineStyle)
  const lensFlare = useSettingsStore((state) => state.lensFlare)
  const setLensFlare = useSettingsStore((state) => state.setLensFlare)
  const groundTrack = useSettingsStore((state) => state.groundTrack)
  const shadows = useSettingsStore((state) => state.shadows)
  const setShadows = useSettingsStore((state) => state.setShadows)
  const setGroundTrack = useSettingsStore((state) => state.setGroundTrack)
  const renderScale = useSettingsStore((state) => state.renderScale)
  const setRenderScale = useSettingsStore((state) => state.setRenderScale)
  // Loading indicator for the pending model candidate.
  const issDetail = useLoadingStore((state) => state.issDetail)
  const isLoadingModel = issDetail.status === 'loading' || issDetail.status === 'preparing'

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        ref={triggerRef}
        id="btn-settings"
        type="button"
        aria-label="Render settings"
        aria-expanded={isOpen}
        aria-keyshortcuts="G"
        data-overlay=""
        onClick={onTriggerClick}
        className="hud-label hud-btn-text hud-tool"
        style={{ color: isOpen ? 'var(--hud-hi)' : undefined }}
      >
        <ToolIcon name="settings" />
        <span className="hud-tool__label">Settings</span>
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Render settings"
          className="hud-settings-popover hud-text"
          data-overlay=""
        >
          <span className="hud-fine" style={{ color: 'var(--hud-lo)', letterSpacing: '0.18em' }}>
            Render settings
          </span>

          <span className="hud-label" style={{ marginTop: 10, color: 'var(--hud-mid)' }}>
            ISS model
          </span>

          <div
            role="radiogroup"
            aria-label="ISS model"
            style={{ display: 'grid', gap: 6, marginTop: 6 }}
            onKeyDown={(event) => handleRadioGroupKeyDown(event, MODEL_VALUES, issModelQuality, setIssModelQuality)}
          >
            {MODEL_OPTIONS.map((option) => {
              const isSelected = issModelQuality === option.value
              // The 'high' setting loads the Locate LOD first; show its spinner
              // on High too, not only when the full asset is the candidate.
              const isPending = isLoadingModel && (
                issDetail.quality === option.value
                || (option.value === 'high' && issDetail.quality === 'locate')
              )
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={radioTabIndex(MODEL_VALUES, issModelQuality, option.value)}
                  onClick={() => setIssModelQuality(option.value)}
                  className={`hud-label hud-option${isSelected ? ' hud-option--on' : ''}`}
                >
                  {option.label}
                  <span
                    className="hud-fine"
                    style={{ display: 'block', marginTop: 3, color: 'var(--hud-lo)', fontSize: 9 }}
                  >
                    {option.hint}
                  </span>
                  {isPending && <span className="hud-settings-spinner" aria-hidden="true" />}
                </button>
              )
            })}
          </div>

          <span className="hud-label" style={{ marginTop: 12, color: 'var(--hud-mid)' }}>
            Orbit line
          </span>

          <div
            role="radiogroup"
            aria-label="Orbit line style"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}
            onKeyDown={(event) => handleRadioGroupKeyDown(event, ORBIT_LINE_VALUES, orbitLineStyle, setOrbitLineStyle)}
          >
            {ORBIT_LINE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={orbitLineStyle === option.value}
                tabIndex={radioTabIndex(ORBIT_LINE_VALUES, orbitLineStyle, option.value)}
                onClick={() => setOrbitLineStyle(option.value)}
                className={`hud-label hud-option${orbitLineStyle === option.value ? ' hud-option--on' : ''}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <span className="hud-label" style={{ marginTop: 12, color: 'var(--hud-mid)' }}>
            Visuals
          </span>

          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              role="switch"
              aria-checked={postprocessing}
              onClick={() => setPostprocessing(!postprocessing)}
              className={`hud-label hud-option${postprocessing ? ' hud-option--on' : ''}`}
            >
              Bloom
            </button>
            {/* The flare is a composer pass, so it cannot exist without the
                compositor. Disabled with a reason rather than silently inert. */}
            <button
              type="button"
              role="switch"
              aria-checked={lensFlare && postprocessing}
              disabled={!postprocessing}
              onClick={() => setLensFlare(!lensFlare)}
              className={`hud-label hud-option${lensFlare && postprocessing ? ' hud-option--on' : ''}`}
            >
              Lens flare
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={groundTrack}
              onClick={() => setGroundTrack(!groundTrack)}
              className={`hud-label hud-option${groundTrack ? ' hud-option--on' : ''}`}
            >
              Ground track
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={shadows}
              onClick={() => setShadows(!shadows)}
              className={`hud-label hud-option${shadows ? ' hud-option--on' : ''}`}
            >
              Shadows
            </button>
          </div>

          {/* Pixel ratio: Auto adapts to frame time; a percentage pins it at
              that share of the device's sharpest setting (renderScale.ts). */}
          <span className="hud-label" style={{ marginTop: 12, color: 'var(--hud-mid)' }}>
            Render scale
          </span>

          <div
            role="radiogroup"
            aria-label="Render scale"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 6 }}
            onKeyDown={(event) => handleRadioGroupKeyDown(event, RENDER_SCALE_VALUES, renderScale, setRenderScale)}
          >
            {RENDER_SCALE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={renderScale === option.value}
                tabIndex={radioTabIndex(RENDER_SCALE_VALUES, renderScale, option.value)}
                onClick={() => setRenderScale(option.value)}
                className={`hud-label hud-option${renderScale === option.value ? ' hud-option--on' : ''}`}
                style={{ textAlign: 'center', paddingInline: 4 }}
              >
                {option.label}
              </button>
            ))}
          </div>

        </div>
      )}
    </div>
  )
}
