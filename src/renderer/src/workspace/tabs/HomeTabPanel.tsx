import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Popover, PopoverContent, PopoverAnchor } from '@renderer/components/ui/popover'
import { Plus, FolderOpen, Library, BookOpen, Clock, X, Trash2 } from 'lucide-react'
import { openDesignTab, openPanelByType, openProjectDialog } from '@renderer/workspace/registry/panelActions'
import { useRecentFilesStore } from '@renderer/workspace/registry/recentFilesStore'
import { useWorkspaceStore } from '@renderer/workspace/layout/layoutStore'
import { useDesignStore } from '@renderer/workspace/design/model/designStore'
import type { IDockviewPanelProps } from 'dockview-react'
import type { TabParams } from '@renderer/workspace/registry/tabTypeRegistry'

/** GitHub logo（lucide 不含品牌图标） */
function GithubIcon({ className }: { className?: string }) {
  _useLocale()
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}


/* ─── helpers ─── */

/** 将时间戳转为友好的相对时间描述 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return _t("刚刚")
  if (minutes < 60) return _msg`${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return _msg`${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return _msg`${days} 天前`
  const months = Math.floor(days / 30)
  return _msg`${months} 个月前`
}

/** 从文件路径中提取简短的目录部分（最后两级目录） */
function shortenPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  if (parts.length <= 3) return filePath
  return '…/' + parts.slice(-3, -1).join('/') + '/'
}

/**
 * Home Tab（FR-03-108 空态/引导入口）。
 * 冷启动默认激活；以 HomeTab.png 为背景的引导页，
 * 提供新建设计 / 打开工程 / 库管理 / 最近打开文档 / GitHub / 帮助文档入口。
 */
export default function HomeTabPanel(_props: IDockviewPanelProps<TabParams>) {
  _useLocale()
  const recentFiles = useRecentFilesStore((s) => s.recentFiles)
  const removeRecent = useRecentFilesStore((s) => s.removeRecent)
  const clearRecent = useRecentFilesStore((s) => s.clearRecent)

  const handleOpenRecent = useCallback(async (filePath: string) => {
    // 若工程已在某个 Tab 中打开，直接定位并激活
    const api = useWorkspaceStore.getState().api
    if (api) {
      const openProjects = useDesignStore.getState().projects
      const matchedEntry = Object.entries(openProjects).find(
        ([_, session]) => session.filePath === filePath
      )
      if (matchedEntry) {
        const existing = api.getPanel(`design:${matchedEntry[0]}`)
        if (existing) {
          existing.api.setActive()
          api.focus()
          return
        }
      }
    }

    try {
      const res = await window.projectApi.read(filePath)
      const fileName = filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.sfb$/i, '') || 'Untitled'

      openDesignTab({
        projectId: `project-${encodeURIComponent(res.filePath)}`,
        name: fileName,
        filePath: res.filePath,
        initialDoc: res.doc,
        initialCacheBuffer: res.cacheBuffer,
        initialGlbBuffer: res.glbBuffer
      })
    } catch (err) {
      console.error('[HomeTab] Failed to open recent file:', filePath, err)
      // 打开失败时移除无效记录
      removeRecent(filePath)
    }
  }, [removeRecent])

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[var(--sf-surface-soft,#E9E9E9)]">
      {/* 背景图 */}
      <img
        src={`${import.meta.env.BASE_URL}HomeTab.png`}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      {/* 顶部过渡渐变：从标题栏背景色 (surface-soft / #E9E9E9) 自然过渡至背景页面，保持视觉一致 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[var(--sf-surface-soft,#E9E9E9)] via-[var(--sf-surface-soft,#E9E9E9)]/60 to-transparent" />

      {/* ─── 主内容面板：Design.md 浅色毛玻璃卡片 ─── */}
      <div
        className="relative z-10 flex w-[90%] max-w-[900px] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/80 shadow-[0_12px_36px_rgba(0,0,0,0.06)] backdrop-blur-xl transition-all"
        style={{ maxHeight: 'calc(100% - 64px)' }}
      >
        {/* 上半区：操作入口 + 最近文档 */}
        <div className="flex flex-1 flex-col gap-0 overflow-hidden md:flex-row">
          {/* ─── 左侧：Logo + 操作入口 ─── */}
          <div className="flex flex-col items-center justify-center gap-5 border-b border-black/8 bg-black/[0.02] px-10 py-10 md:w-[340px] md:border-b-0 md:border-r">
            {/* Logo */}
            <div className="flex size-14 items-center justify-center rounded-xl bg-primary text-xl font-bold tracking-tight text-primary-foreground shadow-sm">
              SF
            </div>

            {/* 标题 */}
            <div className="text-center">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
                Hydraulic Manifold Design
              </p>
              <h1 className="mt-1 text-lg font-bold tracking-tight text-foreground">
                {_t("SureFlow · 阀块设计")}</h1>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {_t("创建工程开始布孔，或在库管理中维护孔腔模板资产")}</p>
            </div>

            {/* 操作按钮 (Design.md 胶囊风格) */}
            <div className="flex w-full max-w-[200px] flex-col gap-2.5 pt-1">
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-primary px-6 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/85 active:scale-[0.98]"
                onClick={() => openDesignTab()}
              >
                <Plus className="size-4" /> {_t("新建设计")}</button>
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border bg-white px-6 text-xs font-medium text-foreground shadow-sm transition-all hover:bg-black/5 hover:border-black/30 active:scale-[0.98]"
                onClick={() => void openProjectDialog()}
                title={_t("打开工程（.sfb）")}
              >
                <FolderOpen className="size-4" /> {_t("打开工程")}</button>
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border/60 bg-transparent px-6 text-xs font-medium text-foreground/80 transition-all hover:bg-black/5 hover:text-foreground active:scale-[0.98]"
                onClick={() => openPanelByType('library')}
              >
                <Library className="size-4" /> {_t("库管理")}</button>
            </div>
          </div>

          {/* ─── 右侧：最近打开文档 ─── */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Clock className="size-4 text-muted-foreground" />
                <span>{_t("最近打开")}</span>
              </div>
              {recentFiles.length > 0 && (
                <button
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground"
                  onClick={clearRecent}
                  title={_t("清空最近打开记录")}
                >
                  <Trash2 className="size-3" /> {_t("清空")}</button>
              )}
            </div>

            {recentFiles.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                <FolderOpen className="size-8 opacity-40" />
                <p className="text-xs">{_t("暂无最近打开的文档")}</p>
                <p className="text-[11px] opacity-60">{_t("打开工程后将在此处显示")}</p>
              </div>
            ) : (
              <div className="flex-1 space-y-1 overflow-y-auto pr-1">
                {recentFiles.map((entry) => (
                  <RecentFileItem
                    key={entry.filePath}
                    entry={entry}
                    onOpen={() => void handleOpenRecent(entry.filePath)}
                    onRemove={() => removeRecent(entry.filePath)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── 底部快捷链接 ─── */}
        <div className="flex items-center justify-center gap-6 border-t border-black/8 bg-black/[0.01] px-6 py-3">
          <button
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground"
            onClick={() => window.open('https://github.com/weianweigan/SureFlow')}
          >
            <GithubIcon className="size-3.5" /> {_t("GitHub 主页")}</button>
          <div className="h-3 w-px bg-border" />
          <button
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground"
            onClick={() => window.open('https://sureflow-docs.hy3d.space')}
          >
            <BookOpen className="size-3.5" /> {_t("帮助文档")}</button>
        </div>
      </div>
    </div>
  )
}

function RecentFileItem({ entry, onOpen, onRemove }: { entry: any, onOpen: () => void, onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!previewImage) {
      window.projectApi.readMeta(entry.filePath).then(meta => {
        if (meta?.previewImage) {
          setPreviewImage(meta.previewImage)
        }
      }).catch(err => {
        console.warn('Failed to read meta for recent file:', err)
      })
    }
  }, [entry.filePath, previewImage])

  const handleMouseEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setOpen(true), 150)
  }

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setOpen(false), 50)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          className="group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-all hover:bg-black/[0.04]"
          onClick={onOpen}
          title={entry.filePath}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* 文件图标/小图 */}
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-black/5 text-muted-foreground overflow-hidden">
            {previewImage ? (
              <img src={previewImage} alt="Preview" className="w-full h-full object-contain" />
            ) : (
              <FolderOpen className="size-4" />
            )}
          </div>
          {/* 文件信息 */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground group-hover:text-primary">
              {entry.name}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {shortenPath(entry.filePath)}
              <span className="ml-2">{formatRelativeTime(entry.timestamp)}</span>
            </p>
          </div>
          {/* 移除按钮 */}
          <button
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/40 opacity-0 transition-all hover:bg-black/10 hover:text-destructive group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            title={_t("从列表中移除")}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </PopoverAnchor>
      {previewImage && (
        <PopoverContent
          side="right"
          sideOffset={8}
          className="p-1 border shadow-xl bg-background rounded-lg pointer-events-none"
        >
          <img src={previewImage} alt="Preview" className="w-[180px] h-[180px] object-contain rounded-md" />
        </PopoverContent>
      )}
    </Popover>
  )
}
