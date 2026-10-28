import { useExplorerStore } from '@/stores/explorerStore'
import { toggleModuleExplorer } from '../clusters/moduleExplorerControl'
import { ToolIcon } from './ToolIcon'

/**
 * Modules — the module explorer's control in the top-right tool row. Works
 * from anywhere: away from the station it locates first and the explorer
 * opens on arrival (moduleExplorerControl.ts). The panel itself stays on
 * the left edge (ModuleExplorerPanel).
 */
export function ModulesButton(): JSX.Element {
  const open = useExplorerStore((state) => state.open)
  return (
    <button
      id="btn-module-explorer"
      type="button"
      aria-label="Modules"
      aria-expanded={open}
      aria-keyshortcuts="M"
      onClick={toggleModuleExplorer}
      className="hud-label hud-btn-text hud-tool"
      style={{ color: open ? 'var(--hud-hi)' : undefined }}
    >
      <ToolIcon name="modules" />
      <span className="hud-tool__label">Modules</span>
    </button>
  )
}
