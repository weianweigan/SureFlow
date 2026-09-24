import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 自定义 Tab header 组件（dockview tabComponents）
 *
 * - icon-home：Home Tab —— 仅 public/Home.svg 图标，无文字、无关闭按钮
 * - locked：单开常驻 Tab（库管理等）—— 带 Library 图标与标题，无关闭按钮
 * - design-tab：设计 Tab —— 带 Block.svg 图标、标题与关闭按钮
 * - viewer-tab：浏览 Tab —— 带格式图标（PDF/URL/图片/3D）、标题与关闭按钮
 */
import React, { useEffect, useState, useRef } from 'react'
import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from 'dockview-react'
import { Library, Globe, FileText, Image as ImageIcon, Box } from 'lucide-react'
import type { TabParams } from '../registry/tabTypeRegistry'
import { useDesignStore } from '@renderer/workspace/design/model/designStore'
import { Popover, PopoverAnchor, PopoverContent } from '@renderer/components/ui/popover'
import { TabContextMenu } from './menu/TabContextMenu'
import { requestClosePanel } from '../registry/panelActions'
import { getCadConnectorIcon } from '@shared/cad/cadProjectLookup'

/**
 * Home Tab header：Home.svg 图标（BASE_URL 兼容 dev/build 的 public 资源路径）。
 */
export function HomeIconTab(props: IDockviewPanelHeaderProps): React.ReactElement {
  _useLocale()
  return (
    <div className="sf-tab sf-tab--icon">
      <img
        src={`${import.meta.env.BASE_URL}Home.svg`}
        className="sf-tab__icon"
        alt={_t("主页")}
        draggable={false}
      />
      <DockviewDefaultTab {...props} hideClose />
    </div>
  )
}

/** 单开常驻 Tab header：带 Library 图标、标题、无关闭按钮（库管理等） */
export function LockedTab(props: IDockviewPanelHeaderProps): React.ReactElement {
  _useLocale()
  return (
    <TabContextMenu panel={props.api} containerApi={props.containerApi} params={props.params as TabParams}>
      <div className="flex h-full items-center gap-1.5 overflow-hidden">
        <Library className="size-3.5 shrink-0 text-muted-foreground" />
        <DockviewDefaultTab {...props} hideClose />
      </div>
    </TabContextMenu>
  )
}

/** 设计 Tab header：带 Block.svg 阀块图标、标题与关闭按钮 */
export function DesignTabHeader(props: IDockviewPanelHeaderProps): React.ReactElement {
  const locale = _useLocale()

  const params = props.params as TabParams | undefined
  const projectId = params?.kind === 'design' ? params.projectId : undefined
  // 动态读取此工程的预览图
  const previewImage = useDesignStore((s) => projectId ? s.projects[projectId]?.doc.meta.previewImage : undefined)
  const projectName = useDesignStore((s) => projectId ? s.projects[projectId]?.doc.meta.projectName : undefined)
  const filePath = useDesignStore((s) => projectId ? s.projects[projectId]?.filePath : undefined)
  const modifiedAt = useDesignStore((s) => projectId ? s.projects[projectId]?.doc.meta.modifiedAt : undefined)
  const cadIntegration = useDesignStore((s) => projectId ? s.projects[projectId]?.cadIntegration : undefined)
  const isCadConnected = cadIntegration?.connectionStatus === 'CONNECTED'
  const isCadProject = !!cadIntegration

  const modifiedDate = modifiedAt ? new Date(modifiedAt) : null
  const modifiedLabel = !filePath ? _t('尚未保存')
    : modifiedDate && Number.isFinite(modifiedDate.getTime())
      ? modifiedDate.toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : _t('暂无记录')

  // 1. 当设计 Tab 来自 CAD 软件时，Header 标题显示 CAD 零件的 docName
  const cadDocName = cadIntegration?.docName || (cadIntegration?.docPath ? cadIntegration.docPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') : undefined)
  const documentName = (isCadProject && cadDocName) ? cadDocName : (filePath?.split(/[\\/]/).pop() || projectName || _t('未命名工程'))

  useEffect(() => {
    if (isCadProject && cadDocName && props.api.title !== cadDocName) {
      props.api.setTitle(cadDocName)
    }
  }, [isCadProject, cadDocName, props.api])

  const [open, setOpen] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const handleMouseEnter = () => {
    if (!projectId) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setOpen(true), 200)
  }

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setOpen(false), 50)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor className="flex h-full items-center overflow-hidden w-full">
        <TabContextMenu
          panel={props.api}
          containerApi={props.containerApi}
          params={props.params as TabParams}
          onOpenChange={(menuOpen) => {
            if (menuOpen) {
              if (timerRef.current) clearTimeout(timerRef.current)
              setOpen(false)
            }
          }}
        >
          <div
            className="flex h-full items-center gap-1.5 overflow-hidden w-full"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {isCadProject ? (
              <div
                className="flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[9px] font-semibold tracking-wider shrink-0 transition-all select-none"
                style={{
                  backgroundColor: isCadConnected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                  borderColor: isCadConnected ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)',
                  color: isCadConnected ? '#10b981' : '#f59e0b'
                }}
                title={isCadConnected ? `已连接 ${cadIntegration?.cadType || 'CAD'} (PID: ${cadIntegration?.processId || '活动'})` : `${cadIntegration?.cadType || 'CAD'} 外部协同已断开/脱机`}
              >
                <img
                  src={`${import.meta.env.BASE_URL}${getCadConnectorIcon(cadIntegration.cadType)}`}
                  className="size-3.5 shrink-0 object-contain"
                  alt={cadIntegration.cadType}
                  draggable={false}
                />
                <span className={`size-1.5 rounded-full ${isCadConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span>{cadIntegration.cadType}</span>
              </div>
            ) : (
              <img
                src={`${import.meta.env.BASE_URL}Block.svg`}
                className="size-3.5 shrink-0"
                alt={_t("设计工程")}
                draggable={false}
              />
            )}
            <DockviewDefaultTab
              {...props}
              closeActionOverride={() => {
                void requestClosePanel(props.api.id)
              }}
            />
          </div>
        </TabContextMenu>
      </PopoverAnchor>
      {projectId && (
        <PopoverContent
          side="bottom"
          sideOffset={8}
          className="w-[280px] p-3 border shadow-xl bg-background rounded-lg pointer-events-none z-50"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {previewImage && (
            <img src={previewImage} alt={documentName} className="w-full h-[200px] object-contain rounded-md mb-2 bg-muted/20" />
          )}
          <div className="space-y-2">
            {isCadProject && (
              <div className="p-2 rounded bg-muted/50 border text-xs space-y-1">
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-primary flex items-center gap-1.5">
                    <img
                      src={`${import.meta.env.BASE_URL}${getCadConnectorIcon(cadIntegration.cadType)}`}
                      className="size-4 shrink-0 object-contain"
                      alt={cadIntegration.cadType}
                      draggable={false}
                    />
                    <span className={`size-2 rounded-full ${isCadConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                    {cadIntegration.cadType} 协同工程
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${isCadConnected ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                    {isCadConnected ? '在线通信' : '脱机离线'}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground break-all">
                  零件: {cadIntegration.docPath?.split(/[\\/]/).pop() || cadIntegration.docPath || documentName}
                </div>
                <div className="text-[10px] text-muted-foreground/80">
                  数据直接保存在 CAD 零件内部 (3rd Party Storage Store)
                </div>
              </div>
            )}
            <div>
              <div className="text-[11px] text-muted-foreground">{_t('工程标题')}</div>
              <div className="text-sm font-medium break-all">{documentName}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">{_t('最后修改时间')}</div>
              <div className="text-xs tabular-nums text-foreground/80">
                {modifiedDate && Number.isFinite(modifiedDate.getTime())
                  ? <time dateTime={modifiedAt}>{modifiedLabel}</time>
                  : modifiedLabel}
              </div>
            </div>
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}

/** 通用浏览 Tab header：带文档格式图标、标题与关闭按钮 */
export function ViewerTabHeader(props: IDockviewPanelHeaderProps): React.ReactElement {
  _useLocale()
  const params = props.params as TabParams | undefined
  const subType = params && params.kind === 'viewer' ? params.subType : 'url'

  let icon = <Globe className="size-3.5 shrink-0 text-blue-500" />
  if (subType === 'pdf') {
    icon = <FileText className="size-3.5 shrink-0 text-red-500" />
  } else if (subType === 'image') {
    icon = <ImageIcon className="size-3.5 shrink-0 text-emerald-500" />
  } else if (subType === 'cad') {
    icon = <Box className="size-3.5 shrink-0 text-indigo-500" />
  }

  return (
    <TabContextMenu
      panel={props.api}
      containerApi={props.containerApi}
      params={props.params as TabParams}
    >
      <div className="flex h-full items-center gap-1.5 overflow-hidden">
        {icon}
        <DockviewDefaultTab
          {...props}
          closeActionOverride={() => {
            void requestClosePanel(props.api.id)
          }}
        />
      </div>
    </TabContextMenu>
  )
}

/** CAD 连接器 Tab Header */
export function ConnectorsTabHeader(props: IDockviewPanelHeaderProps): React.ReactElement {
  _useLocale()
  return (
    <TabContextMenu
      panel={props.api}
      containerApi={props.containerApi}
      params={props.params as TabParams}
    >
      <div className="flex h-full items-center gap-1.5 overflow-hidden">
        <img
          src={`${import.meta.env.BASE_URL}connector.svg`}
          alt={_t("CAD 连接器")}
          className="size-3.5 shrink-0 object-contain"
          draggable={false}
        />
        <DockviewDefaultTab
          {...props}
          closeActionOverride={() => {
            void requestClosePanel(props.api.id)
          }}
        />
      </div>
    </TabContextMenu>
  )
}

/** dockview tabComponents 注册表（key 与注册表 tabComponent 字段对应） */
export const TAB_HEADERS = {
  'icon-home': HomeIconTab,
  locked: LockedTab,
  'design-tab': DesignTabHeader,
  'viewer-tab': ViewerTabHeader,
  'connectors-tab': ConnectorsTabHeader
}
