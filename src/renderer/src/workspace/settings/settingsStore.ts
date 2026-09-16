import { create } from 'zustand'
import { MOUSE_PRESETS, validBindings, type MousePreset, type MouseBindings } from '@shared/settings/mouseBindings'

export const SETTINGS_KEY = 'sureflow:settings'
export const DEFAULT_SETTINGS = {
  locale: 'zh-CN' as 'zh-CN' | 'en-US',
  designMousePreset: 'sureflow' as MousePreset,
  designMouseCustomBindings: { ...MOUSE_PRESETS.sureflow } as MouseBindings,
  designReverseWheel: false,
  startupPage: 'home' as 'home' | 'library',
  recordRecent: true,
  designOrigin: true,
  designGrid: false,
  designPerformance: false,
  libraryZoom: 'normal' as 'slow' | 'normal' | 'fast',
  imageWheelZoom: true,
  imageZoom: 'normal' as 'slow' | 'normal' | 'fast',
  pdfRecommendedPage: true,
  cadGrid: true,
  cadEdges: true,
  webPopups: true
}
export type Settings = typeof DEFAULT_SETTINGS
export type SettingKey = keyof Settings
export const zoomFactor = (speed: Settings['imageZoom']): number =>
  ({ slow: 1.06, normal: 1.12, fast: 1.25 })[speed]

export function normalizeSettings(input: unknown): Settings {
  const result = { ...DEFAULT_SETTINGS }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result
  const values = input as Record<string, unknown>
  for (const key of Object.keys(result) as SettingKey[]) {
    const value = values[key]
    if (key === 'locale' && (value === 'zh-CN' || value === 'en-US')) {
      result[key] = value
    } else if (key === 'designMousePreset' && typeof value === 'string' && ['sureflow', 'solidworks', 'creo', 'nx', 'custom'].includes(value)) {
      result[key] = value as MousePreset
    } else if (key === 'designMouseCustomBindings' && validBindings(value)) {
      result[key] = { ...value }
    } else if (typeof result[key] === 'boolean' && typeof value === 'boolean') {
      Object.assign(result, { [key]: value })
    } else if (key === 'startupPage' && (value === 'home' || value === 'library')) {
      result[key] = value
    } else if ((key === 'imageZoom' || key === 'libraryZoom') &&
      (value === 'slow' || value === 'normal' || value === 'fast')) {
      result[key] = value
    }
  }
  return result
}

export function loadSettings(): { values: Settings; error: string | null } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { values: { ...DEFAULT_SETTINGS }, error: null }
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1 || !parsed.values || typeof parsed.values !== 'object' || Array.isArray(parsed.values)) {
      throw new Error('Unsupported settings')
    }
    return { values: normalizeSettings(parsed.values), error: null }
  } catch {
    return { values: { ...DEFAULT_SETTINGS }, error: '无法读取本机设置，已使用默认值。可重试保存。' }
  }
}

function saveSettings(values: Settings): string | null {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, values }))
    return null
  } catch {
    return '保存失败：更改仅在本次会话有效，请重试。'
  }
}

interface SettingsState {
  values: Settings
  error: string | null
  update: <K extends SettingKey>(key: K, value: Settings[K]) => void
  reset: (keys: readonly SettingKey[]) => void
  saveMouseBindings: (bindings: MouseBindings) => boolean
  retry: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadSettings(),
  update: (key, value) => {
    const values = normalizeSettings({ ...get().values, [key]: value })
    set({ values, error: saveSettings(values) })
  },
  reset: (keys) => {
    const values = { ...get().values }
    for (const key of keys) Object.assign(values, { [key]: DEFAULT_SETTINGS[key] })
    set({ values, error: saveSettings(values) })
  },
  saveMouseBindings: (bindings) => {
    if (!validBindings(bindings)) return false
    const values = { ...get().values, designMousePreset: 'custom' as const, designMouseCustomBindings: { ...bindings } }
    set({ values, error: saveSettings(values) })
    return true
  },
  retry: () => set({ error: saveSettings(get().values) })
}))
