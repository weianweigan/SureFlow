/**
 * 工作区全局状态（M1 最小版）
 *
 * 持有 DockviewApi 引用与当前激活面板，供 Home/「+」等入口触发
 * 面板创建/定位（FR-03-103 单开常驻、FR-03-104 新建设计）。
 * 布局序列化（FR-03-111~113）与 LRU 信号在 M3/M4 扩展本 store。
 */
import { create } from 'zustand'
import type { DockviewApi } from 'dockview-react'

interface WorkspaceState {
  /** dockview 实例（onReady 后可用） */
  api: DockviewApi | null
  /** 当前激活面板 id */
  activePanelId: string | null
  setApi: (api: DockviewApi) => void
  setActivePanelId: (id: string | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  api: null,
  activePanelId: null,
  setApi: (api) => set({ api }),
  setActivePanelId: (activePanelId) => set({ activePanelId })
}))
