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
    <div className="flex h-full items-center gap-1.5 overflow-hidden">
      <Library className="size-3.5 shrink-0 text-muted-foreground" />
      <DockviewDefaultTab {...props} hideClose />
    </div>
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
  const documentName = filePath?.split(/[\\/]/).pop() || projectName || _t('未命名工程')
  const modifiedDate = modifiedAt ? new Date(modifiedAt) : null
  const modifiedLabel = !filePath ? _t('尚未保存')
    : modifiedDate && Number.isFinite(modifiedDate.getTime())
      ? modifiedDate.toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : _t('暂无记录')

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
      <PopoverAnchor asChild>
        <div 
          className="flex h-full items-center gap-1.5 overflow-hidden w-full"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <img
            src={`${import.meta.env.BASE_URL}Block.svg`}
            className="size-3.5 shrink-0"
            alt={_t("设计工程")}
            draggable={false}
          />
          <DockviewDefaultTab {...props} />
        </div>
      </PopoverAnchor>
      {projectId && (
        <PopoverContent 
          side="bottom" 
          sideOffset={8}
          className="w-[272px] p-3 border shadow-xl bg-background rounded-lg pointer-events-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {previewImage && (
            <img src={previewImage} alt={documentName} className="w-full h-[240px] object-contain rounded-md mb-3" />
          )}
          <div className="space-y-2">
            <div>
              <div className="text-[11px] text-muted-foreground">{_t('文档名称')}</div>
              <div className="text-sm font-medium break-all">{documentName}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">{_t('最后修改时间')}</div>
              <div className="text-xs tabular-nums">
                {filePath && modifiedDate && Number.isFinite(modifiedDate.getTime())
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
    <div className="flex h-full items-center gap-1.5 overflow-hidden">
      {icon}
      <DockviewDefaultTab {...props} />
    </div>
  )
}

/** dockview tabComponents 注册表（key 与注册表 tabComponent 字段对应） */
export const TAB_HEADERS = {
  'icon-home': HomeIconTab,
  locked: LockedTab,
  'design-tab': DesignTabHeader,
  'viewer-tab': ViewerTabHeader
}
