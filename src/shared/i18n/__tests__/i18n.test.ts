import { afterEach, describe, expect, it } from 'vitest'
import { setLocale, t, msg, translateMessage, subscribeLocale } from '..'

afterEach(() => setLocale('zh-CN'))
describe('localization', () => {
  it('switches messages synchronously and notifies existing UI subscribers', () => {
    let changes = 0
    const off = subscribeLocale(() => changes++)
    expect(t('设置')).toBe('设置')
    setLocale('en-US')
    expect(t('设置')).toBe('Settings')
    setLocale('zh-CN')
    expect(t('设置')).toBe('设置')
    expect(changes).toBe(2)
    off()
  })
  it('keeps user-entered values out of translation and falls back for missing keys', () => {
    setLocale('en-US')
    const name = '设置'
    expect(msg`工程「${name}」有尚未保存的更改。`).toBe('Project “设置” has unsaved changes.')
    expect(t('用户自己的内容')).toBe('用户自己的内容')
  })
  it('translates renderer-owned diagnostics while retaining embedded values', () => {
    setLocale('en-US')
    expect(translateMessage('子孔「设置」引用缺少模板 id')).toBe('Sub-hole “设置” has no referenced template ID')
    expect(translateMessage('第 2 段直径必须 > 0')).toBe('Step 2: diameter must be positive')
  })
  it('translates connector center labels and dynamic messages', () => {
    setLocale('en-US')
    expect(t('CAD 协同连接器')).toBe('CAD Co-Design Connector')
    expect(t('连接中心')).toBe('Connector Center')
    expect(t('SolidWorks 协同连接器')).toBe('SolidWorks Connector')
    expect(msg`已检测到 ${2} 款`).toBe('Detected (2)')
    expect(msg`正在下载并静默安装 ${t('SolidWorks 协同连接器')}...`).toBe(
      'Downloading and silently installing SolidWorks Connector...'
    )
    expect(t('安装')).toBe('Install')
    expect(t('重新安装')).toBe('Reinstall')
    expect(t('下载')).toBe('Download')
  })
})
