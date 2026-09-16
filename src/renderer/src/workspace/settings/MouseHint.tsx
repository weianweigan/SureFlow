import { gestureLabel, MOUSE_PRESETS } from '@shared/settings/mouseBindings'
import { useSettingsStore } from './settingsStore'

/** Keep viewport help consistent with the active navigation bindings. */
export function MouseHint() {
  const preset = useSettingsStore(state => state.values.designMousePreset)
  const customBindings = useSettingsStore(state => state.values.designMouseCustomBindings)
  const bindings = preset === 'custom' ? customBindings : MOUSE_PRESETS[preset]
  return <>{gestureLabel(bindings.rotate)}旋转 · {gestureLabel(bindings.pan)}平移 · 滚轮或{gestureLabel(bindings.zoom)}缩放</>
}
