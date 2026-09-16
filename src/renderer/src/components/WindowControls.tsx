import { AppMenu } from './AppMenu'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/**
 * 自定义窗口控制按钮（无边框窗口）：最小化 / 最大化还原 / 关闭。
 * 与 Tab 管理条同行（见 WorkspaceRoot 的 sf-window-bar 布局）。
 */
export function WindowControls(): React.ReactElement {
  _useLocale()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let disposed = false
    void window.windowControls.isMaximized().then((value) => {
      if (!disposed) setMaximized(value)
    })
    const unsubscribe = window.windowControls.onMaximizedChange(setMaximized)
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return (
    <div className="sf-window-controls" role="toolbar" aria-label={_t("设置与窗口控制")}>
      <span className="sf-window-controls__preview-tag" title={_t("当前版本为预览版本")}>
        {_t("Preview")}
      </span>
      <AppMenu />
      <div className="sf-window-controls__divider" role="separator" aria-orientation="vertical" />
      <button
        className="sf-window-controls__btn"
        onClick={() => window.windowControls.minimize()}
        title={_t("最小化")}
        aria-label={_t("最小化")}
      >
        <Minus className="size-3.5" />
      </button>
      <button
        className="sf-window-controls__btn"
        onClick={() => window.windowControls.toggleMaximize()}
        title={maximized ? _t("还原") : _t("最大化")}
        aria-label={maximized ? _t("还原") : _t("最大化")}
      >
        {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
      </button>
      <button
        className={cn('sf-window-controls__btn', 'sf-window-controls__btn--close')}
        onClick={() => window.windowControls.close()}
        title={_t("关闭")}
        aria-label={_t("关闭")}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
