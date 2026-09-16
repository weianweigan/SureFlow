import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import type { FC } from 'react'
import type { ViewPreset } from './Viewer3D'

interface ToolbarProps {
  viewPreset: ViewPreset
  onViewChange: (preset: ViewPreset) => void
}

const VIEWS: { preset: ViewPreset; label: string }[] = [
  { preset: 'perspective', label: '透视' },
  { preset: 'top', label: '俯视' },
  { preset: 'front', label: '主视' },
  { preset: 'right', label: '右视' }
]

/**
 * 顶部工具栏：工程文件操作（占位）与视图切换。
 * 文件操作后续通过 IPC 接入主进程（详见 prd/）。
 */
export const Toolbar: FC<ToolbarProps> = ({ viewPreset, onViewChange }) => {
  _useLocale()
  return (
    <header className="toolbar">
      <div className="toolbar__title">
        <img className="toolbar__logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="SureFlow" />
        {_t("SureFlow · 阀块设计")}</div>

      <div className="toolbar__divider" />

      {/* 文件操作：骨架阶段为占位，未接 IPC */}
      <button className="tool-btn" title={_t("新建工程（待接入）")}>
        {_t("新建")}</button>
      <button className="tool-btn" title={_t("打开工程（待接入）")}>
        {_t("打开")}</button>
      <button className="tool-btn" title={_t("保存工程（待接入）")} disabled>
        {_t("保存")}</button>

      <div className="toolbar__divider" />

      {/* 标准视图 */}
      {VIEWS.map((v) => (
        <button
          key={v.preset}
          className={`tool-btn${viewPreset === v.preset ? ' tool-btn--active' : ''}`}
          onClick={() => onViewChange(v.preset)}
        >
          {_t(v.label)}
        </button>
      ))}

      <div className="toolbar__spacer" />

      <span className="sf-caption">{_t("v0.1.0 · 脚手架")}</span>
    </header>
  )
}
