import { MOUSE } from 'three'
import { MOUSE_PRESETS, navigationAction } from '@shared/settings/mouseBindings'
import type { Settings } from '../../settings/settingsStore'
export interface NavigationControls {
  mouseButtons: { LEFT?: MOUSE; MIDDLE?: MOUSE; RIGHT?: MOUSE }
  zoomSpeed: number
}
export function configureNavigation(orbit: NavigationControls, e: Parameters<typeof navigationAction>[0], settings: Settings): void {
  const bindings = settings.designMousePreset === 'custom' ? settings.designMouseCustomBindings : MOUSE_PRESETS[settings.designMousePreset]
  const action = navigationAction(e, bindings)
  // three-stdlib swaps rotate and pan for Ctrl/Shift. Undo that implicit mapping.
  const swap = e.ctrlKey || e.metaKey || e.shiftKey
  const code = action === 'zoom' ? MOUSE.DOLLY : action === 'rotate' ? (swap ? MOUSE.PAN : MOUSE.ROTATE) : action === 'pan' ? (swap ? MOUSE.ROTATE : MOUSE.PAN) : undefined
  orbit.mouseButtons.LEFT = undefined
  orbit.mouseButtons.MIDDLE = e.button === 1 ? code : undefined
  orbit.mouseButtons.RIGHT = e.button === 2 ? code : undefined
  orbit.zoomSpeed = 1
}
