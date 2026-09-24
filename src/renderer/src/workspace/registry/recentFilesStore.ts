/**
 * 最近打开文件记录 Store（Zustand + localStorage 持久化）
 *
 * 用于 Home Tab 显示最近打开的工程列表。
 * 数据保存在 localStorage（key = sureflow:recent-files），最多保留 10 条。
 */
import { useSettingsStore } from '../settings/settingsStore'
import { create } from 'zustand'

const STORAGE_KEY = 'sureflow:recent-files'
const MAX_RECENT = 10

export interface RecentFileEntry {
  /** 文件绝对路径 */
  filePath: string
  /** 工程名称 */
  name: string
  /** 最后打开时间戳（ms） */
  timestamp: number
}

interface RecentFilesState {
  recentFiles: RecentFileEntry[]
  /** 添加/更新记录（置顶 + 去重） */
  addRecent: (filePath: string, name: string) => void
  /** 移除指定记录 */
  removeRecent: (filePath: string) => void
  /** 清空所有记录 */
  clearRecent: () => void
}

function loadFromStorage(): RecentFileEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e: unknown): e is RecentFileEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as RecentFileEntry).filePath === 'string' &&
        (e as RecentFileEntry).filePath.toLowerCase().endsWith('.sfb') &&
        typeof (e as RecentFileEntry).name === 'string' &&
        typeof (e as RecentFileEntry).timestamp === 'number'
    )
  } catch {
    return []
  }
}

function saveToStorage(entries: RecentFileEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* localStorage quota exceeded — 静默降级 */
  }
}

export const useRecentFilesStore = create<RecentFilesState>((set) => ({
  recentFiles: loadFromStorage(),

  addRecent: (filePath: string, name: string) =>
    set((state) => {
      if (!useSettingsStore.getState().values.recordRecent) return state
      if (!filePath || !filePath.toLowerCase().endsWith('.sfb')) return state
      const filtered = state.recentFiles.filter((e) => e.filePath !== filePath)
      const updated = [{ filePath, name, timestamp: Date.now() }, ...filtered].slice(0, MAX_RECENT)
      saveToStorage(updated)
      return { recentFiles: updated }
    }),

  removeRecent: (filePath: string) =>
    set((state) => {
      const updated = state.recentFiles.filter((e) => e.filePath !== filePath)
      saveToStorage(updated)
      return { recentFiles: updated }
    }),

  clearRecent: () => {
    saveToStorage([])
    return set({ recentFiles: [] })
  }
}))
