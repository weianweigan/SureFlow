import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { consumeSystemFiles } from './registry/systemFileActions'
import { useSettingsStore } from './settings/settingsStore'
import { Fragment, Suspense, useCallback, useEffect, useState } from 'react'
import { DockviewReact, type DockviewReadyEvent } from 'dockview-react'
import { PANEL_COMPONENTS, PanelFallback } from './registry/buildComponents'
import { TAB_HEADERS } from './tabs/tabHeaders'
import { openDesignTab, openProjectDialog, openPanelByType } from './registry/panelActions'
import { useWorkspaceStore } from './layout/layoutStore'
import { useDesignStore } from './design/model/designStore'
import { WindowControls } from '@renderer/components/WindowControls'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Separator } from '@renderer/components/ui/separator'
import { Plus, FolderOpen, Settings, Library } from 'lucide-react'

interface ActionMenuItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  action: () => void | Promise<void>
  separatorBefore?: boolean
}

/** Tab 条右侧「+」工作区菜单入口（支持新建阀块设计、打开工程、设置等，方便后续扩展） */
function NewDesignTabAction(): React.ReactElement {
  _useLocale()
  const [open, setOpen] = useState(false)

  const menuItems: ActionMenuItem[] = [
    {
      id: 'new-design',
      label: _t("新建阀块设计"),
      icon: Plus,
      action: () => openDesignTab()
    },
    {
      id: 'open-design',
      label: _t("打开阀块设计"),
      icon: FolderOpen,
      action: () => void openProjectDialog()
    },
    {
      id: 'library',
      label: _t("库管理"),
      icon: Library,
      separatorBefore: true,
      action: () => openPanelByType('library')
    },
    {
      id: 'settings',
      label: _t("设置"),
      icon: Settings,
      action: () => openPanelByType('settings')
    }
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="mx-1 h-10"
          title={_t("新建与更多操作")}
          aria-label={_t("新建与更多操作")}
        >
          <img
            src={`${import.meta.env.BASE_URL}Plus.svg`}
            className="sf-tab__icon"
            alt={_t("新建与更多操作")}
            draggable={false}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        className="w-44 p-1 flex flex-col gap-0.5 shadow-lg border border-border bg-popover/95 backdrop-blur-md rounded-lg z-50 select-none"
      >
        {menuItems.map((item) => (
          <Fragment key={item.id}>
            {item.separatorBefore && <Separator className="my-1 bg-border" />}
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer select-none"
              onClick={() => {
                setOpen(false)
                void item.action()
              }}
            >
              <item.icon className="size-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
            </button>
          </Fragment>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/**
 * 工作区根容器（FR-03-100）：单个 DockviewReact 实例承载全部工作区 Tab。
 *
 * M1 骨架行为：
 * - 冷启动默认布局：Home（激活）+ 库管理（单开常驻）
 * - 库管理锁定：拦截拖出（FR-03-103）
 * - 激活面板追踪（供后续会话恢复/LRU 使用）
 */
export function WorkspaceRoot(): React.ReactElement {
  _useLocale()
  useEffect(() => window.settingsApi?.onFilesPending(() => {
    if (useWorkspaceStore.getState().api) void consumeSystemFiles().catch(console.error)
  }), [])
  useEffect(() => window.settingsApi?.onNavigateHome?.(() => {
    openPanelByType('home')
  }), [])
  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api
    useWorkspaceStore.getState().setApi(api)

    // 冷启动默认布局：Home（激活，图标 Tab 无关闭）+ 库管理（inactive 保持 Home 激活）
    api.addPanel({
      id: 'home',
      component: 'home',
      params: { kind: 'home' },
      title: _t("主页"),
      tabComponent: 'icon-home'
    })
    api.addPanel({
      id: 'library',
      component: 'library',
      params: { kind: 'library' },
      title: _t("库管理"),
      tabComponent: 'locked',
      inactive: true,
      position: { referencePanel: 'home', direction: 'within' }
    })

    // 激活面板追踪
    api.onDidActivePanelChange((e) => {
      useWorkspaceStore.getState().setActivePanelId(e?.panel?.id ?? null)
    })

    // 面板关闭时清理工程会话
    api.onDidRemovePanel((panel) => {
      if (panel.id.startsWith('design:')) {
        const projectId = panel.id.replace(/^design:/, '')
        useDesignStore.getState().removeProject(projectId)
      }
    })

    api.getPanel(useSettingsStore.getState().values.startupPage)?.api.setActive()

    void consumeSystemFiles().catch(console.error)

    // 库管理 Tab 锁定：不允许拖出顶层 group（FR-03-103）
    // 注：dockview 拦截方式为 event.nativeEvent.preventDefault()
    api.onWillDragPanel((e) => {
      if (e.panel.id === 'library' || e.panel.id === 'home') e.nativeEvent.preventDefault()
    })
    api.onWillDragGroup((e) => {
      if (e.group.panels.some((p) => p.id === 'library' || p.id === 'home')) {
        e.nativeEvent.preventDefault()
      }
    })
  }, [])

  return (
    <div className="sf-window-bar">
      {/* 兜底边界：面板自身已带 Suspense（见 buildComponents），此处仅防御 DockviewReact 首挂 */}
      <Suspense fallback={<PanelFallback />}>
        <DockviewReact
          className="workspace-root"
          components={PANEL_COMPONENTS}
          tabComponents={TAB_HEADERS}
          rightHeaderActionsComponent={NewDesignTabAction}
          onReady={onReady}
        />
      </Suspense>
      <WindowControls />
    </div>
  )
}
