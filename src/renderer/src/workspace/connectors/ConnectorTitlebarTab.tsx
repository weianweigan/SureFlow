import React, { useEffect } from 'react'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t } from '@shared/i18n'
import { useCadBridgeStore, initCadStatusWatcher } from './cadBridgeStatusStore'
import { useWorkspaceStore } from '../layout/layoutStore'
import { openPanelByType } from '../registry/panelActions'
import { getCadConnectorIcon } from '@shared/cad/cadProjectLookup'
import { cn } from '@renderer/lib/utils'

/**
 * 标题栏 CAD 连接器 Tab（位于 PREVIEW 右侧、应用菜单左侧）
 * - 默认使用 connector.svg
 * - 当检测到有三维软件建立连接时，紧随其后显示具体三维软件图标与在线呼吸灯
 * - 点击激活或打开 CAD 连接器工作区 Tab
 */
export function ConnectorTitlebarTab(): React.ReactElement {
  _useLocale()
  const status = useCadBridgeStore((s) => s.status)
  const activePanelId = useWorkspaceStore((s) => s.activePanelId)
  const isActive = activePanelId === 'connectors'

  useEffect(() => {
    const cleanup = initCadStatusWatcher()
    return () => cleanup()
  }, [])

  const isConnected = status.connected && Boolean(status.currentCadType)
  const cadType = status.currentCadType || 'CAD'
  const cadIcon = isConnected ? getCadConnectorIcon(status.currentCadType) : null

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    openPanelByType('connectors')
  }

  const tooltipTitle = isConnected
    ? t('已连接 ') + cadType + t(' · 实时协同中 (点击打开连接器中心)')
    : t('CAD 协同连接器 · 点击打开中心')

  return (
    <button
      type="button"
      onClick={handleClick}
      title={tooltipTitle}
      aria-label={tooltipTitle}
      aria-selected={isActive}
      className={cn(
        'group relative inline-flex items-center gap-1.5 h-7 px-2.5 mx-1 rounded-md text-xs font-medium select-none transition-all cursor-pointer',
        '-webkit-app-region: no-drag;',
        isActive
          ? 'bg-background text-foreground shadow-xs border border-border/80'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/70 border border-transparent'
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* 基础连接器图标 */}
      <img
        src={`${import.meta.env.BASE_URL}connector.svg`}
        alt={t('连接器')}
        className="size-4 shrink-0 object-contain transition-transform group-hover:scale-105"
        draggable={false}
      />

      {/* 如果有三维软件已经建立连接，在其后紧跟具体三维软件图标 */}
      {isConnected && cadIcon && (
        <div className="flex items-center gap-1 shrink-0 animate-in fade-in duration-200">
          <span className="text-[10px] text-muted-foreground/60 leading-none">/</span>
          <img
            src={`${import.meta.env.BASE_URL}${cadIcon}`}
            alt={cadType}
            className="size-4 shrink-0 object-contain drop-shadow-xs"
            draggable={false}
          />
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0 ml-0.5" />
        </div>
      )}

      {/* 文本标签 */}
      <span className="text-xs truncate hidden sm:inline-block max-w-[85px]">
        {isConnected ? cadType : t('连接器')}
      </span>

      {/* 激活状态底部微高亮条 */}
      {isActive && (
        <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
      )}
    </button>
  )
}
