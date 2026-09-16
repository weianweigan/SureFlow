import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { configureNavigation } from './mouseNavigationAdapter'
import { useSettingsStore } from '../../settings/settingsStore'

/** Capture chooses one navigation action before OrbitControls handles the gesture.
 * Left-button selection/manipulators remain untouched. Bindings are sampled only at
 * pointer-down, so a settings change cannot alter an in-flight drag.
 */
export function MouseNavigation() {
  const { gl, controls } = useThree()
  const pointer = useRef<number | null>(null)
  useEffect(() => {
    const orbit = controls as OrbitControlsImpl | null
    if (!orbit) return
    const canvas = gl.domElement
    const previous = { ...orbit.mouseButtons }
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || pointer.current !== null || !orbit.enabled) return
      pointer.current = e.pointerId
      configureNavigation(orbit, e, useSettingsStore.getState().values)
    }
    const up = (e: PointerEvent) => { if (e.pointerId === pointer.current) pointer.current = null }
    const blur = () => { pointer.current = null }
    const wheel = () => {
      if (pointer.current === null) orbit.zoomSpeed = useSettingsStore.getState().values.designReverseWheel ? -1 : 1
    }
    canvas.addEventListener('pointerdown', down, true)
    canvas.addEventListener('wheel', wheel, { capture: true, passive: true })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('blur', blur)
    return () => {
      canvas.removeEventListener('pointerdown', down, true)
      canvas.removeEventListener('wheel', wheel, true)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('blur', blur)
      Object.assign(orbit.mouseButtons, previous)
      orbit.zoomSpeed = 1
      pointer.current = null
    }
  }, [gl, controls])
  return null
}
