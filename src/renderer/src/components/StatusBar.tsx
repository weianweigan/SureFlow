import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import type { FC } from 'react'

/** 状态栏：操作提示 + 油口图例 + 运行时信息 */
export const StatusBar: FC = () => {
  _useLocale()
  const versions = window.api?.versions

  return (
    <footer className="statusbar">
      <div className="statusbar__group">
        <span>{_t("左键旋转 · 中键平移 · 滚轮缩放")}</span>
        <span>{_t("坐标轴：X 红 / Y 绿 / Z 蓝")}</span>
      </div>

      <div className="statusbar__group">
        <span className="legend">
          <span className="legend__dot" style={{ background: '#dc2626' }} />
          {_t("P 压力口")}</span>
        <span className="legend">
          <span className="legend__dot" style={{ background: '#2563eb' }} />
          {_t("T 回油口")}</span>
        <span className="legend">
          <span className="legend__dot" style={{ background: '#eab308' }} />
          {_t("A 工作口")}</span>
        <span className="legend">
          <span className="legend__dot" style={{ background: '#16a34a' }} />
          {_t("B 工作口")}</span>
      </div>

      <div className="statusbar__group">
        {versions && (
          <span>
            Electron {versions.electron} · Chromium {versions.chrome} · Node {versions.node}
          </span>
        )}
        <span>{_t("就绪")}</span>
      </div>
    </footer>
  )
}
