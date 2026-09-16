import { UpdateSettings } from '@renderer/components/UpdateControls'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { MouseSettings } from '../settings/MouseSettings'
import { FileAssociationSettings } from '../settings/FileAssociationSettings'
import { t } from '@shared/i18n'
import { useState } from 'react'
import { Settings, Search, RotateCcw } from 'lucide-react'
import { SETTINGS_SECTIONS } from '../settings/settingsRegistry'
import { useSettingsStore } from '../settings/settingsStore'
import type { Settings as SettingsValues } from '../settings/settingsStore'
import { Button } from '@renderer/components/ui/button'
import '../settings/settings.css'

export default function SettingsTabPanel() {
  _useLocale()
  const { values, error, update, reset, retry } = useSettingsStore()
  const [active, setActive] = useState('general')
  const [query, setQuery] = useState('')
  const [confirmReset, setConfirmReset] = useState<string | null>(null)
  const search = query.trim().toLowerCase()
  const sections = SETTINGS_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !search ||
      `${section.title} ${section.subtitle} ${item.label} ${item.description} ${t(section.title)} ${t(item.label)} ${t(item.description)}`.toLowerCase().includes(search))
  })).filter((section) => search ? section.items.length > 0 : section.id === active)

  const showUpdates = search ? ['更新 update version 版本'].some(s => s.includes(search)) : active === 'general'
  const showMouse = search ? ["鼠标 旋转 平移 滚轮 预设 自定义 SolidWorks Creo UG NX", 'mouse rotate pan zoom preset custom design'].some(s => s.toLowerCase().includes(search)) : active === 'design'
  const showAssociations = search ? ["文件关联 sfb sfzip", 'file associations'].some(s => s.includes(search)) : active === 'general'

  return (
    <div className="sf-settings">
      <header className="sf-settings__header">
        <div className="flex items-center gap-3"><Settings size={23} /><div>
          <h1 className="text-xl font-semibold">{_t("设置")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{_t("自定义软件与各类文件 Tab 的使用偏好")}</p>
        </div></div>
        <div className="sf-settings__status" role="status" aria-live="polite">
          {t(error) || _t("已保存到本机 · 更改自动保存")}
          {error && <Button variant="outline" size="sm" onClick={retry}>{_t("重试保存")}</Button>}
        </div>
      </header>
      <div className="sf-settings__body">
        <nav className="sf-settings__nav" aria-label={_t("设置分类")}>
          {SETTINGS_SECTIONS.map((section) => (
            <button key={section.id} aria-current={!search && active === section.id ? 'page' : undefined}
              onClick={() => { setActive(section.id); setQuery(''); setConfirmReset(null) }}>
              {t(section.title)}
            </button>
          ))}
        </nav>
        <main className="sf-settings__main">
          <label className="sf-settings__search"><Search size={16} />
            <input type="search" aria-label={_t("搜索设置")} placeholder={_t("搜索设置，例如：网格、缩放、PDF")}
              value={query} onChange={(e) => { setQuery(e.target.value); setConfirmReset(null) }} />
          </label>
          {sections.length === 0 && !showMouse && !showAssociations && !showUpdates && <div className="sf-settings__empty">
            <p>{_t("没有找到与“")}{query}{_t("”相关的设置")}</p>
            <Button variant="outline" onClick={() => setQuery('')}>{_t("清除搜索")}</Button>
          </div>}
          {sections.map((section) => (
            <section key={section.id} className="sf-settings__section" aria-labelledby={`section-${section.id}`}>
              <div className="sf-settings__section-title">
                <div><h2 id={`section-${section.id}`} className="text-base font-semibold">{t(section.title)}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{t(section.subtitle)}</p></div>
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(section.id)}>
                  <RotateCcw size={13} />{_t("恢复此分类默认")}</Button>
              </div>
              {confirmReset === section.id && <div className="sf-settings__confirm" role="group" aria-label={_t("确认恢复默认")}>
                <span>{_t("将恢复“")}{t(section.title)}{_t("”的全部设置（包括搜索未显示项），其他分类保持不变。")}</span>
                <Button size="sm" onClick={() => {
                  reset(SETTINGS_SECTIONS.find((s) => s.id === section.id)!.items.map((item) => item.key))
                  setConfirmReset(null)
                }}>{_t("确认恢复")}</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmReset(null)}>{_t("取消")}</Button>
              </div>}
              <div className="sf-settings__card">
                {section.items.map((item) => (
                  <div key={item.key} className="sf-settings__row">
                    <div><label htmlFor={`setting-${item.key}`} className="text-sm font-medium">{t(item.label)}</label>
                      <p id={`help-${item.key}`} className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t(item.description)}</p></div>
                    {item.options ? <select id={`setting-${item.key}`} aria-describedby={`help-${item.key}`}
                      value={String(values[item.key])}
                      onChange={(e) => update(item.key, e.target.value as SettingsValues[typeof item.key])}>
                      {item.options.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
                    </select> : <input id={`setting-${item.key}`} type="checkbox" role="switch"
                      aria-describedby={`help-${item.key}`} checked={Boolean(values[item.key])}
                      onChange={(e) => update(item.key, e.target.checked)} />}
                  </div>
                ))}
              </div>
            </section>
          ))}
          {showUpdates && <UpdateSettings />}
          {showMouse && <MouseSettings />}
          {showAssociations && <FileAssociationSettings />}
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">{_t("设置仅保存在本机，不修改工程或孔腔库文件。标注“新打开的 Tab 生效”的选项不会覆盖当前 Tab 的操作状态。")}</p>
        </main>
      </div>
    </div>
  )
}
