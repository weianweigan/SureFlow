export const GESTURES = ['middle', 'right', 'ctrl-middle', 'shift-middle', 'alt-middle', 'ctrl-right', 'shift-right', 'alt-right'] as const
export type Gesture = typeof GESTURES[number]
export type NavigationAction = 'rotate' | 'pan' | 'zoom'
export type MouseBindings = Record<NavigationAction, Gesture>
export type MousePreset = 'sureflow' | 'solidworks' | 'creo' | 'nx' | 'custom'
export const MOUSE_PRESETS: Record<Exclude<MousePreset, 'custom'>, MouseBindings> = {
  sureflow: { rotate: 'right', pan: 'middle', zoom: 'ctrl-middle' },
  solidworks: { rotate: 'middle', pan: 'ctrl-middle', zoom: 'shift-middle' },
  creo: { rotate: 'middle', pan: 'shift-middle', zoom: 'ctrl-middle' },
  nx: { rotate: 'middle', pan: 'shift-middle', zoom: 'ctrl-middle' }
}
export const PRESET_NAMES: Record<MousePreset, string> = {
  sureflow: 'SureFlow', solidworks: 'SolidWorks', creo: 'Creo', nx: 'UG / NX', custom: '自定义'
}
export function validBindings(value: unknown): value is MouseBindings {
  if (!value || typeof value !== 'object') return false
  const b = value as MouseBindings
  return ['rotate', 'pan', 'zoom'].every(key => GESTURES.includes(b[key as NavigationAction])) &&
    new Set([b.rotate, b.pan, b.zoom]).size === 3
}
export function navigationAction(event: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, bindings: MouseBindings): NavigationAction | null {
  if (event.button !== 1 && event.button !== 2) return null
  const modifiers = [event.ctrlKey || event.metaKey, event.shiftKey, event.altKey]
  if (modifiers.filter(Boolean).length > 1) return null
  const prefix = modifiers[0] ? 'ctrl-' : modifiers[1] ? 'shift-' : modifiers[2] ? 'alt-' : ''
  const gesture = `${prefix}${event.button === 1 ? 'middle' : 'right'}`
  return (Object.keys(bindings) as NavigationAction[]).find(action => bindings[action] === gesture) ?? null
}
export function gestureLabel(gesture: Gesture): string {
  return gesture.replace('ctrl-', 'Ctrl/⌘ + ').replace('shift-', 'Shift + ').replace('alt-', 'Alt + ')
    .replace('middle', '中键拖动').replace('right', '右键拖动')
}
