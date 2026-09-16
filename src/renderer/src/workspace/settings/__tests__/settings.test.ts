import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

let storage: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value)
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('设置持久化与恢复', () => {
  it('旧版本缺少字段时合并默认值，拒绝非法枚举和类型', async () => {
    const { normalizeSettings, DEFAULT_SETTINGS } = await import('../settingsStore')
    expect(normalizeSettings({ designGrid: true, cadGrid: 'false', startupPage: 'bad', imageZoom: 'fast', unknown: 2 }))
      .toEqual({ ...DEFAULT_SETTINGS, designGrid: true, imageZoom: 'fast' })
  })
  it.each(['broken json', '{"version":99,"values":{}}', '{"version":1,"values":[]}'])('损坏或不支持的配置安全回退：%s', async (raw) => {
    storage.set('sureflow:settings', raw)
    const { useSettingsStore, DEFAULT_SETTINGS } = await import('../settingsStore')
    expect(useSettingsStore.getState().values).toEqual(DEFAULT_SETTINGS)
    expect(useSettingsStore.getState().error).toBeTruthy()
  })
  it('修改后重新加载保持值，恢复分类不影响其他分类', async () => {
    const { useSettingsStore, loadSettings } = await import('../settingsStore')
    useSettingsStore.getState().update('designGrid', true)
    useSettingsStore.getState().update('imageZoom', 'fast')
    expect(loadSettings().values.designGrid).toBe(true)
    useSettingsStore.getState().reset(['designGrid', 'designOrigin', 'designPerformance'])
    expect(loadSettings().values.designGrid).toBe(false)
    expect(loadSettings().values.imageZoom).toBe('fast')
  })
  it('存储失败仍保留会话设置，重试成功后清除错误', async () => {
    const { useSettingsStore, loadSettings } = await import('../settingsStore')
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('Quota') })
    useSettingsStore.getState().update('recordRecent', false)
    expect(useSettingsStore.getState().values.recordRecent).toBe(false)
    expect(useSettingsStore.getState().error).toContain('保存失败')
    useSettingsStore.getState().retry()
    expect(useSettingsStore.getState().error).toBeNull()
    expect(loadSettings().values.recordRecent).toBe(false)
    spy.mockRestore()
  })
  it('关闭最近文件记录不添加新记录，也不删除已有记录', async () => {
    const { useSettingsStore } = await import('../settingsStore')
    const { useRecentFilesStore } = await import('../../registry/recentFilesStore')
    useRecentFilesStore.getState().addRecent('/old.sfb', 'old')
    useSettingsStore.getState().update('recordRecent', false)
    useRecentFilesStore.getState().addRecent('/new.sfb', 'new')
    expect(useRecentFilesStore.getState().recentFiles.map((file) => file.name)).toEqual(['old'])
  })
  it('设置面板重复打开激活同一个，关闭后可重新创建', async () => {
    const { openPanelByType } = await import('../../registry/panelActions')
    const { useWorkspaceStore } = await import('../../layout/layoutStore')
    let panel: unknown
    const setActive = vi.fn()
    const api = {
      getPanel: () => panel,
      focus: vi.fn(),
      addPanel: vi.fn(() => { panel = { api: { setActive } } })
    }
    useWorkspaceStore.getState().setApi(api as never)
    openPanelByType('settings')
    openPanelByType('settings')
    expect(api.addPanel).toHaveBeenCalledTimes(1)
    expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'settings', component: 'settings', title: '设置' }))
    expect(setActive).toHaveBeenCalledOnce()
    panel = undefined
    openPanelByType('settings')
    expect(api.addPanel).toHaveBeenCalledTimes(2)
  })
})
