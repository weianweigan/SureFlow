import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { OrbitControls } from 'three-stdlib'
import { MOUSE_PRESETS, navigationAction, validBindings, type Gesture } from '@shared/settings/mouseBindings'
import { DEFAULT_SETTINGS } from '../../../settings/settingsStore'
import { configureNavigation } from '../mouseNavigationAdapter'

// A deterministic DOM event target for real OrbitControls; no WebGL is needed.
class Target {
  handlers = new Map<string, Set<(event: any) => void>>()
  style = { touchAction: '' }
  clientWidth = 800
  clientHeight = 600
  ownerDocument: Target = this
  addEventListener(type: string, handler: (event: any) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
  }
  removeEventListener(type: string, handler: (event: any) => void) { this.handlers.get(type)?.delete(handler) }
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 } }
  dispatch(type: string, event: object) { for (const handler of this.handlers.get(type) ?? []) handler(event) }
}
function eventFor(gesture: Gesture) {
  return { button: gesture.endsWith('middle') ? 1 : 2, ctrlKey: gesture.startsWith('ctrl-'), shiftKey: gesture.startsWith('shift-'),
    altKey: gesture.startsWith('alt-'), metaKey: false, pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 300, preventDefault() {} }
}

describe('mouse preset camera behavior', () => {
  for (const [preset, bindings] of Object.entries(MOUSE_PRESETS)) {
    for (const action of ['rotate', 'pan', 'zoom'] as const) {
      it(`${preset}: ${action} moves the real OrbitControls camera correctly`, () => {
        const target = new Target()
        const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
        camera.position.set(4, 3, 5)
        const controls = new OrbitControls(camera, target as unknown as HTMLElement)
        const startPosition = camera.position.clone()
        const startTarget = controls.target.clone()
        const distance = camera.position.distanceTo(controls.target)
        const down = eventFor(bindings[action])
        configureNavigation(controls, down, { ...DEFAULT_SETTINGS, designMousePreset: preset as keyof typeof MOUSE_PRESETS })
        target.dispatch('pointerdown', down)
        target.dispatch('pointermove', { ...down, clientX: 440, clientY: 325 })
        target.dispatch('pointerup', down)
        expect(camera.position.distanceTo(startPosition)).toBeGreaterThan(0.001)
        if (action === 'pan') expect(controls.target.distanceTo(startTarget)).toBeGreaterThan(0.001)
        else expect(controls.target.distanceTo(startTarget)).toBeLessThan(0.001)
        if (action === 'zoom') expect(camera.position.distanceTo(controls.target)).not.toBeCloseTo(distance)
        else expect(camera.position.distanceTo(controls.target)).toBeCloseTo(distance)
        controls.dispose()
      })
    }
  }
  it('reserves all left-button gestures for selection and rejects duplicate mappings', () => {
    for (const bindings of Object.values(MOUSE_PRESETS)) {
      expect(validBindings(bindings)).toBe(true)
      expect(navigationAction({ ...eventFor('ctrl-middle'), button: 0 }, bindings)).toBeNull()
    }
    expect(validBindings({ rotate: 'middle', pan: 'middle', zoom: 'ctrl-middle' })).toBe(false)
    expect(validBindings({ rotate: 'left', pan: 'middle', zoom: 'ctrl-middle' })).toBe(false)
  })
  it('does not reinterpret a multi-modifier gesture as a preset command', () => {
    expect(navigationAction({ ...eventFor('ctrl-middle'), shiftKey: true }, MOUSE_PRESETS.solidworks)).toBeNull()
  })
})
