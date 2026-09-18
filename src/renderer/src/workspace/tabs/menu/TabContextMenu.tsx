import { FC, ReactNode, useMemo } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import type { DockviewPanelApi, DockviewApi } from 'dockview-react'
import type { TabParams } from '../../registry/tabTypeRegistry'
import { useDesignStore } from '../../design/model/designStore'
import { useLibraryStore } from '../../library/viewmodel/libraryStore'
import {
  requestClosePanel,
  closeOtherPanels
} from '../../registry/panelActions'

interface TabContextMenuProps {
  panel: DockviewPanelApi
  containerApi: DockviewApi
  params?: TabParams
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

export const TabContextMenu: FC<TabContextMenuProps> = ({
  panel,
  containerApi,
  params,
  onOpenChange,
  children
}) => {
  _useLocale()

  const isMac = useMemo(() => {
    return (
      window.api?.platform === 'darwin' ||
      (typeof navigator !== 'undefined' && /Macintosh|Mac OS X/i.test(navigator.userAgent))
    )
  }, [])

  const panelId = panel.id
  const kind = params?.kind

  // 1. 设计工程 Tab 状态
  const projectId = params && params.kind === 'design' ? params.projectId : undefined
  const projectSession = useDesignStore((s) => (projectId ? s.projects[projectId] : undefined))
  const isDirty = projectSession?.dirty ?? false
  const isSaving = projectSession?.saving ?? false
  const projectFilePath = projectSession?.filePath

  // 2. 库管理 Tab 状态
  const activeDirPath = useLibraryStore((s) => s.activeDirPath)

  // 3. 通用资料浏览 Tab 状态
  const isViewer = kind === 'viewer'
  const isOnlineUrl = useMemo(() => {
    if (!isViewer || !params) return false
    const target = params.target || ''
    return params.subType === 'url' || target.startsWith('http://') || target.startsWith('https://')
  }, [isViewer, params])

  const resolvedViewerFilePath = useMemo(() => {
    if (!isViewer || !params || isOnlineUrl) return null
    let raw = params.target.trim()
    if (params.libraryDirPath && !raw.startsWith('/') && !/^[a-zA-Z]:/.test(raw)) {
      raw = `${params.libraryDirPath.replace(/\\/g, '/')}/${raw.replace(/\\/g, '/')}`
    }
    return raw
  }, [isViewer, params, isOnlineUrl])

  // 4. 批量关闭可操作性状态
  const hasOtherClosable = useMemo(() => {
    try {
      const allPanels = containerApi.panels
      return allPanels.some(
        (p) => p.id !== panelId && p.id !== 'home' && p.id !== 'library'
      )
    } catch {
      return false
    }
  }, [containerApi, panelId])

  // 操作处理函数
  const handleSave = () => {
    if (!projectId || !projectSession) return
    void useDesignStore.getState().saveProject(projectId)
  }

  const handleSaveAs = () => {
    if (!projectId || !projectSession) return
    void useDesignStore.getState().saveAsProject(projectId)
  }

  const handleRevealInFolder = (targetPath?: string | null) => {
    if (!targetPath) return
    void window.api?.showItemInFolder?.(targetPath)
  }

  const handleCopyText = (text?: string | null) => {
    if (!text) return
    void navigator.clipboard.writeText(text)
  }

  const handleClose = () => {
    void requestClosePanel(panelId)
  }

  const handleCloseOthers = () => {
    void closeOtherPanels(panelId)
  }

  const revealLabel = isMac ? _t('在访达中显示') : _t('在文件资源管理器中显示')
  const saveShortcut = isMac ? '⌘S' : 'Ctrl+S'
  const saveAsShortcut = isMac ? '⌘⇧S' : 'Ctrl+Shift+S'
  const closeShortcut = isMac ? '⌘W' : 'Ctrl+W'

  return (
    <ContextMenu
      onOpenChange={(open) => {
        onOpenChange?.(open)
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {/* A. 设计工程 Tab */}
        {kind === 'design' && (
          <>
            <ContextMenuItem
              disabled={isSaving || (!isDirty && !!projectFilePath)}
              onClick={handleSave}
            >
              <span>{_t('保存')}</span>
              <ContextMenuShortcut>{saveShortcut}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={isSaving} onClick={handleSaveAs}>
              <span>{_t('另存为...')}</span>
              <ContextMenuShortcut>{saveAsShortcut}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!projectFilePath}
              onClick={() => handleRevealInFolder(projectFilePath)}
            >
              <span>{revealLabel}</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        {/* B. 通用资料浏览 Tab */}
        {kind === 'viewer' && (
          <>
            {!isOnlineUrl ? (
              <>
                <ContextMenuItem
                  disabled={!resolvedViewerFilePath}
                  onClick={() => handleRevealInFolder(resolvedViewerFilePath)}
                >
                  <span>{revealLabel}</span>
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!resolvedViewerFilePath}
                  onClick={() => handleCopyText(resolvedViewerFilePath)}
                >
                  <span>{_t('复制文件路径')}</span>
                </ContextMenuItem>
              </>
            ) : (
              <ContextMenuItem onClick={() => handleCopyText(params?.target)}>
                <span>{_t('复制链接')}</span>
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}

        {/* C. 库管理 Tab */}
        {kind === 'library' && (
          <>
            <ContextMenuItem
              disabled={!activeDirPath}
              onClick={() => handleRevealInFolder(activeDirPath)}
            >
              <span>{revealLabel}</span>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!activeDirPath}
              onClick={() => handleCopyText(activeDirPath)}
            >
              <span>{_t('复制库路径')}</span>
            </ContextMenuItem>
          </>
        )}

        {/* D. 关闭动作组（仅针对非系统常驻的动态 Tab：design / viewer） */}
        {panelId !== 'home' && panelId !== 'library' && (
          <>
            <ContextMenuItem onClick={handleClose}>
              <span>{_t('关闭')}</span>
              <ContextMenuShortcut>{closeShortcut}</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuItem disabled={!hasOtherClosable} onClick={handleCloseOthers}>
              <span>{_t('关闭其他 Tab')}</span>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
