import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 设计 Tab 主面板（三栏弹性伸缩布局）
 *
 * 左：方案组与时间线特征树
 * 中：3D 工程视口与顶栏保存/历史动作
 * 右：双 Tab（属性面板 / 孔腔库）
 *
 * 快捷键支持：
 * - Ctrl+S: 保存
 * - Ctrl+Shift+S: 另存为
 * - Ctrl+Z: 撤销
 * - Ctrl+Y / Ctrl+Shift+Z: 重做
 */

import { useEffect, useState, type FC } from 'react'
import { useDesignStore } from '../model/designStore'
import { DesignLeftSidebar } from './sidebar/DesignLeftSidebar'
import { DesignViewport } from './viewport/DesignViewport'
import { DesignRightPanel } from './right/DesignRightPanel'
import type { SfbProject } from '@shared/design/types'
import { VerticalResizer } from './common/Resizer'

const LEFT_MIN = 200
const LEFT_MAX = 520
const RIGHT_MIN = 280
const RIGHT_MAX = 620

const LEFT_DEFAULT = 280
const RIGHT_DEFAULT = 360

const STORAGE_KEY_LEFT = 'sureflow:design:left-width'
const STORAGE_KEY_RIGHT = 'sureflow:design:right-width'

export interface DesignPanelProps {
  projectId: string
  name?: string
  filePath?: string
  initialDoc?: SfbProject
  initialCacheBuffer?: ArrayBuffer | null
  initialGlbBuffer?: ArrayBuffer | null
}

export const DesignPanel: FC<DesignPanelProps> = ({
  projectId,
  name,
  filePath,
  initialDoc,
  initialCacheBuffer,
  initialGlbBuffer
}) => {
  _useLocale()
  const initProject = useDesignStore((s) => s.initProject)
  const session = useDesignStore((s) => s.projects[projectId])
  const saveProject = useDesignStore((s) => s.saveProject)
  const saveAsProject = useDesignStore((s) => s.saveAsProject)
  const undo = useDesignStore((s) => s.undo)
  const redo = useDesignStore((s) => s.redo)

  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_LEFT)
    return saved ? parseInt(saved, 10) : LEFT_DEFAULT
  })

  const [rightWidth, setRightWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_RIGHT)
    return saved ? parseInt(saved, 10) : RIGHT_DEFAULT
  })

  // 初始化工程会话（若传入了二进制缓存则即刻秒开首帧呈现）
  useEffect(() => {
    initProject(projectId, initialDoc, filePath, initialCacheBuffer, initialGlbBuffer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, initialDoc, filePath, initialCacheBuffer, initialGlbBuffer])

  // 保存宽度到 localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_LEFT, String(leftWidth))
  }, [leftWidth])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RIGHT, String(rightWidth))
  }, [rightWidth])

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return

      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        if (e.shiftKey) {
          void saveAsProject(projectId)
        } else {
          void saveProject(projectId)
        }
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo(projectId)
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo(projectId)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projectId, saveProject, saveAsProject, undo, redo])

  if (!session) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        {_t("正在加载工程「")}{name || projectId}」...
      </div>
    )
  }

  return (
    <div className="flex h-full w-full bg-background overflow-hidden select-none">
      {/* 左栏：方案组与特征树 */}
      <aside className="flex shrink-0 flex-col" style={{ width: leftWidth }}>
        <DesignLeftSidebar projectId={projectId} />
      </aside>

      <VerticalResizer
        value={leftWidth}
        onChange={setLeftWidth}
        min={LEFT_MIN}
        max={LEFT_MAX}
        defaultValue={LEFT_DEFAULT}
      />

      {/* 中栏：3D 视口与顶栏 */}
      <main className="flex min-w-0 flex-1 flex-col">
        <DesignViewport projectId={projectId} />
      </main>

      <VerticalResizer
        value={rightWidth}
        onChange={setRightWidth}
        min={RIGHT_MIN}
        max={RIGHT_MAX}
        defaultValue={RIGHT_DEFAULT}
        reverse
      />

      {/* 右栏：属性面板与孔腔库 */}
      <aside className="flex shrink-0 flex-col" style={{ width: rightWidth }}>
        <DesignRightPanel projectId={projectId} />
      </aside>
    </div>
  )
}
