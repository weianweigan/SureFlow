import { useState, useRef, useEffect } from 'react'
import {
  Menu,
  Settings,
  Download,
  Bug,
  MessageSquare,
  Info,
  RefreshCw,
  Check,
  CircleAlert,
  Terminal
} from 'lucide-react'
import { useLocale } from '@renderer/i18n/useLocale'
import { t } from '@shared/i18n'
import { openPanelByType } from '@renderer/workspace/registry/panelActions'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Separator } from './ui/separator'
import { useUpdateState, UpdateDetails } from './UpdateControls'
import { AboutDialog } from './AboutDialog'

export function AppMenu() {
  useLocale()
  const state = useUpdateState()
  const [menuOpen, setMenuOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const prompted = useRef<string | undefined>(undefined)

  // 自动弹出准备就绪的更新通知
  useEffect(() => {
    if ((state.status === 'ready' || state.status === 'manual') && prompted.current !== state.version) {
      prompted.current = state.version
      setUpdateOpen(true)
    }
  }, [state.status, state.version])

  const handleOpenExternal = (url: string) => {
    if (window.api?.openExternal) {
      void window.api.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  // 计算下载/更新状态文字
  const getUpdateLabel = () => {
    if (state.status === 'downloading') {
      return `${t('正在下载更新')} (${(state.percent ?? 0).toFixed(0)}%)`
    }
    if (state.status === 'ready') {
      return t('更新已就绪，立即重启')
    }
    if (state.status === 'manual') {
      return t('下载最新版本')
    }
    if (state.status === 'checking') {
      return t('正在检查更新…')
    }
    return t('下载与更新')
  }

  const hasUpdateBadge = state.status === 'ready' || state.status === 'manual' || state.status === 'downloading'

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            className="sf-window-controls__btn relative"
            title={t('应用菜单')}
            aria-label={t('应用菜单')}
          >
            {state.status === 'downloading' ? (
              <RefreshCw className="size-4 animate-spin text-primary" />
            ) : (
              <Menu className="size-4" />
            )}
            {hasUpdateBadge && (
              <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary ring-2 ring-background animate-pulse" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={4}
          className="w-52 p-1 flex flex-col gap-0.5 shadow-xl border border-border bg-popover/95 backdrop-blur-md rounded-lg z-[1001] select-none text-popover-foreground"
        >
          {/* 1. 设置 */}
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer select-none"
            onClick={() => {
              setMenuOpen(false)
              openPanelByType('settings')
            }}
          >
            <Settings className="size-4 text-muted-foreground shrink-0" />
            <span className="flex-1 text-left">{t('设置')}</span>
          </button>

          {/* 2. 下载与更新 */}
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer select-none"
            onClick={() => {
              setMenuOpen(false)
              setUpdateOpen(true)
            }}
          >
            {state.status === 'downloading' ? (
              <RefreshCw className="size-4 text-primary animate-spin shrink-0" />
            ) : state.status === 'ready' ? (
              <Check className="size-4 text-emerald-500 shrink-0" />
            ) : state.status === 'error' ? (
              <CircleAlert className="size-4 text-destructive shrink-0" />
            ) : (
              <Download className="size-4 text-muted-foreground shrink-0" />
            )}
            <span className="flex-1 text-left truncate">{getUpdateLabel()}</span>
            {hasUpdateBadge && (
              <span className="size-1.5 rounded-full bg-primary shrink-0" />
            )}
          </button>

          <Separator className="my-1 bg-border" />

          {/* 3. 反馈 Bug */}
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer select-none"
            onClick={() => {
              setMenuOpen(false)
              handleOpenExternal('https://github.com/weianweigan/SureFlow/issues')
            }}
          >
            <Bug className="size-4 text-muted-foreground shrink-0" />
            <span className="flex-1 text-left">{t('报告 Bug')}</span>
          </button>

          {/* 4. 问题与建议 */}
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer select-none"
            onClick={() => {
              setMenuOpen(false)
              handleOpenExternal('https://github.com/weianweigan/SureFlow/discussions')
            }}
          >
            <MessageSquare className="size-4 text-muted-foreground shrink-0" />
            <span className="flex-1 text-left">{t('问题与建议')}</span>
          </button>

          <Separator className="my-1 bg-border" />

          {/* 5. 开发者工具 */}
          {window.windowControls?.toggleDevTools && (
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer select-none"
              onClick={() => {
                setMenuOpen(false)
                window.windowControls.toggleDevTools()
              }}
            >
              <Terminal className="size-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-left">{t('开发者工具')}</span>
            </button>
          )}

          <Separator className="my-1 bg-border" />

          {/* 5. 关于 SureFlow */}
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer select-none"
            onClick={() => {
              setMenuOpen(false)
              setAboutOpen(true)
            }}
          >
            <Info className="size-4 text-muted-foreground shrink-0" />
            <span className="flex-1 text-left">{t('关于 SureFlow')}</span>
          </button>
        </PopoverContent>
      </Popover>

      {/* 独立更新弹窗浮层 */}
      <Popover open={updateOpen} onOpenChange={setUpdateOpen}>
        <PopoverTrigger asChild>
          <span className="hidden" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={8}
          className="w-96 max-w-[calc(100vw-24px)] p-4 shadow-2xl border border-border bg-popover z-[1002]"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <UpdateDetails state={state} later={() => setUpdateOpen(false)} />
        </PopoverContent>
      </Popover>

      {/* 关于对话框 */}
      <AboutDialog isOpen={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  )
}
